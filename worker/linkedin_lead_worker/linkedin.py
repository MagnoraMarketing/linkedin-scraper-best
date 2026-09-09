"""Playwright driver for LinkedIn.

Refactored from the upstream project's LinkedInScraper into a service-shaped
class: construct it, call `run_search`, get leads back through a callback.

What was deliberately NOT carried over from upstream:

  * The stealth init script (navigator.webdriver spoofing, fake plugin lists,
    a patched permissions API) and the AutomationControlled launch flag.
  * User-agent rotation pools and free-proxy rotation.
  * Polling through a CAPTCHA / 2FA checkpoint waiting for someone to solve it.

Those exist to defeat access controls. This worker does the opposite: when
LinkedIn asks for verification or serves a sign-in wall, it stops and reports
that to the user. What it does keep from upstream is the part that is about
being a well-behaved client — conservative delays, bounded retries with
exponential backoff, session reuse so repeated logins are not needed, and the
field extraction rules.
"""

from __future__ import annotations

import asyncio
import logging
import random
from pathlib import Path
from typing import Awaitable, Callable

from playwright.async_api import (
    Browser,
    BrowserContext,
    Page,
    Playwright,
    TimeoutError as PlaywrightTimeoutError,
    async_playwright,
)

from .config import Config
from .geo import location_text_matches, resolve_location
from .models import JobErrorCode, ScrapedLead, ScraperStop, SearchParams
from . import parsing

logger = logging.getLogger(__name__)

LeadCallback = Callable[[ScrapedLead], Awaitable[bool]]
"""Called for each scraped lead. Return False to stop the run early."""

LogCallback = Callable[[str, str, str], Awaitable[None]]
"""(level, event, message) — mirrors run progress into the job log."""


class LinkedInScraper:
    def __init__(self, config: Config) -> None:
        self._config = config
        self._playwright: Playwright | None = None
        self._browser: Browser | None = None
        self._context: BrowserContext | None = None
        self._page: Page | None = None
        self._requests_since_break = 0
        self._on_log: LogCallback | None = None

    # -- lifecycle -----------------------------------------------------------

    async def start(self) -> None:
        self._playwright = await async_playwright().start()
        self._browser = await self._playwright.chromium.launch(
            headless=self._config.headless,
            args=["--no-sandbox", "--disable-dev-shm-usage"],
        )

        storage_state = self._session_file()
        self._context = await self._browser.new_context(
            viewport={"width": 1440, "height": 900},
            locale="en-US",
            storage_state=str(storage_state) if storage_state.exists() else None,
        )
        self._context.set_default_timeout(self._config.timeout_ms)
        self._page = await self._context.new_page()

        # Images and fonts are pure bandwidth here — nothing is extracted from
        # them, and skipping them makes each page load meaningfully cheaper.
        await self._page.route(
            "**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2,ttf,mp4}",
            lambda route: asyncio.ensure_future(route.abort()),
        )

        logger.info("Browser started", extra={"event": "browser_start"})

    async def stop(self) -> None:
        for closer in (
            getattr(self._context, "close", None),
            getattr(self._browser, "close", None),
            getattr(self._playwright, "stop", None),
        ):
            if closer is None:
                continue
            try:
                await closer()
            except Exception as exc:  # noqa: BLE001 - shutdown must not raise
                logger.warning("Error during browser shutdown: %s", exc)

        self._page = None
        self._context = None
        self._browser = None
        self._playwright = None

    async def __aenter__(self) -> "LinkedInScraper":
        await self.start()
        return self

    async def __aexit__(self, *_: object) -> None:
        await self.stop()

    def _session_file(self) -> Path:
        directory = self._config.session_path
        directory.mkdir(parents=True, exist_ok=True)
        safe = self._config.linkedin_email.replace("@", "_at_").replace("/", "_")
        return directory / f"{safe}.storage_state.json"

    # -- authentication ------------------------------------------------------

    async def _is_logged_in(self) -> bool:
        page = self._require_page()
        if any(marker in page.url for marker in ("/feed", "/mynetwork", "/messaging")):
            return True
        try:
            return await page.query_selector("nav.global-nav, .global-nav") is not None
        except Exception:  # noqa: BLE001 - a detached page is simply not logged in
            return False

    async def login(self) -> None:
        """Signs in, reusing a saved session when one is valid.

        Raises ScraperStop with a specific code rather than retrying past a
        rejection: a wrong password does not become right on the third attempt,
        and repeated attempts are what gets an account locked.
        """
        page = self._require_page()

        # 1. Try the persisted session first — no form, no challenge.
        if self._session_file().exists():
            try:
                await page.goto(
                    "https://www.linkedin.com/feed/",
                    wait_until="domcontentloaded",
                    timeout=self._config.timeout_ms,
                )
                await self._pause(2, 4)
                if await self._is_logged_in():
                    logger.info("Reused saved LinkedIn session", extra={"event": "login_restored"})
                    await self._log("info", "login", "Reused the saved LinkedIn session.")
                    return
                logger.info("Saved session expired; signing in again")
                await self._context_clear_cookies()
            except PlaywrightTimeoutError:
                logger.warning("Timed out restoring session; signing in fresh")

        # 2. Fresh sign-in.
        await self._fresh_login()

    async def _context_clear_cookies(self) -> None:
        if self._context is not None:
            await self._context.clear_cookies()

    async def _fresh_login(self) -> None:
        page = self._require_page()

        try:
            await page.goto(
                "https://www.linkedin.com/login",
                wait_until="domcontentloaded",
                timeout=self._config.timeout_ms,
            )
            await self._pause(1.5, 3)

            await page.fill("#username", self._config.linkedin_email)
            await self._pause(0.4, 1.0)
            await page.fill("#password", self._config.linkedin_password)
            await self._pause(0.4, 1.0)
            await page.click('button[type="submit"]')

            try:
                await page.wait_for_load_state("domcontentloaded", timeout=self._config.timeout_ms)
            except PlaywrightTimeoutError:
                pass
            await self._pause(3, 5)

        except PlaywrightTimeoutError as exc:
            raise ScraperStop(
                JobErrorCode.TIMEOUT,
                "Timed out loading the LinkedIn sign-in page.",
            ) from exc

        if await self._is_logged_in():
            await self._save_session()
            logger.info("Signed in to LinkedIn", extra={"event": "login_ok"})
            await self._log("info", "login", "Signed in to LinkedIn.")
            return

        html = await page.content()
        block = parsing.detect_block(page.url, html)

        if block == "challenge":
            raise ScraperStop(
                JobErrorCode.REQUIRES_VERIFICATION,
                "LinkedIn requires a verification step that has to be completed by a person.",
            )

        # A visible form error means the credentials were rejected.
        error_element = await page.query_selector("#error-for-password, #error-for-username, .form__error")
        if error_element or "/login" in page.url:
            raise ScraperStop(
                JobErrorCode.LOGIN_FAILED,
                "LinkedIn rejected the scraper account's credentials.",
            )

        raise ScraperStop(
            JobErrorCode.LOGIN_FAILED,
            "Could not sign in to LinkedIn. The account may need attention.",
        )

    async def _save_session(self) -> None:
        if self._context is None:
            return
        try:
            await self._context.storage_state(path=str(self._session_file()))
        except Exception as exc:  # noqa: BLE001 - a missing cache is not fatal
            logger.warning("Could not persist the LinkedIn session: %s", exc)

    # -- search --------------------------------------------------------------

    async def run_search(
        self,
        params: SearchParams,
        on_lead: LeadCallback,
        skip_urls: set[str] | None = None,
        on_log: LogCallback | None = None,
    ) -> None:
        """Runs one job: collect profile URLs, then scrape them one at a time.

        A single profile that fails never fails the job — it is retried, then
        skipped. Only a login, verification or auth-wall problem stops the run,
        because those mean nothing further will succeed either.
        """
        self._on_log = on_log
        skip = skip_urls or set()
        location = resolve_location(params.country, params.location)

        await self._log(
            "info",
            "job_started",
            f"Searching for {', '.join(params.job_titles)} in "
            f"{location.country_name}"
            + (f" ({params.location})" if params.location not in ("", "all") else "")
            + f" — target {params.limit} leads.",
        )

        if not location.filters_server_side:
            await self._log(
                "warn",
                "location_fallback",
                "No verified LinkedIn location id for this country; filtering by "
                "the location text on each profile instead.",
            )

        profile_urls = await self._collect_profile_urls(params, location, skip)

        if not profile_urls:
            raise ScraperStop(
                JobErrorCode.NO_RESULTS,
                "LinkedIn returned no new profiles for these search criteria.",
            )

        await self._log(
            "info",
            "profiles_found",
            f"{len(profile_urls)} profiles to check.",
        )

        found = 0
        for index, url in enumerate(profile_urls, start=1):
            if found >= params.limit:
                break

            lead = await self._scrape_profile_with_retries(url, params, location)

            if lead is None:
                continue

            keep = await on_lead(lead)
            if not keep:
                await self._log("info", "job_stopping", "Stopping at the caller's request.")
                return

            found += 1

            # Pace the run. This is the single most important thing the worker
            # does to stay within LinkedIn's limits.
            if index < len(profile_urls) and found < params.limit:
                await self._pause(
                    self._config.min_delay_seconds, self._config.max_delay_seconds
                )
                await self._maybe_take_break()

    async def _collect_profile_urls(
        self,
        params: SearchParams,
        location: object,
        skip: set[str],
    ) -> list[str]:
        """Walks search result pages for every requested title until the target
        count is comfortably covered."""
        page = self._require_page()
        geo_urn = getattr(location, "geo_urn", None)

        collected: dict[str, None] = {}
        # Over-collect: keyword search is fuzzy and post-filtering discards a
        # meaningful share of results.
        target = params.limit * 3

        for title in params.job_titles:
            if len(collected) >= target:
                break

            for page_number in range(1, self._config.max_search_pages + 1):
                if len(collected) >= target:
                    break

                url = parsing.build_people_search_url(title, geo_urn, page=page_number)

                try:
                    await page.goto(
                        url, wait_until="domcontentloaded", timeout=self._config.timeout_ms
                    )
                except PlaywrightTimeoutError:
                    logger.warning("Search page timed out: %s page %s", title, page_number)
                    await self._log(
                        "warn", "search_timeout", f"Search page {page_number} for '{title}' timed out."
                    )
                    break

                await self._pause(2, 4)
                html = await page.content()

                self._raise_if_blocked(page.url, html)

                if parsing.has_no_results(html):
                    break

                new_urls = [
                    candidate
                    for candidate in parsing.extract_profile_urls(html)
                    if candidate.rstrip("/").lower() not in skip
                ]

                if not new_urls:
                    break

                for candidate in new_urls:
                    collected.setdefault(candidate, None)

                await self._log(
                    "info",
                    "search_page",
                    f"'{title}' page {page_number}: {len(new_urls)} profiles.",
                )

                self._requests_since_break += 1
                await self._pause(3, 6)
                await self._maybe_take_break()

        return list(collected)

    async def _scrape_profile_with_retries(
        self,
        url: str,
        params: SearchParams,
        location: object,
    ) -> ScrapedLead | None:
        """Scrapes one profile, retrying transient failures with backoff."""
        for attempt in range(1, self._config.max_retries + 1):
            try:
                return await self._scrape_profile(url, params, location)
            except ScraperStop:
                # Login/verification problems are not per-profile issues.
                raise
            except PlaywrightTimeoutError:
                if attempt >= self._config.max_retries:
                    logger.warning("Giving up on %s after %s attempts", url, attempt)
                    await self._log("warn", "profile_skipped", f"Timed out on {url}; skipped.")
                    return None
                backoff = min(60.0, 5.0 * (2 ** (attempt - 1))) * random.uniform(0.8, 1.2)
                logger.info("Retrying %s in %.0fs (attempt %s)", url, backoff, attempt)
                await asyncio.sleep(backoff)
            except Exception as exc:  # noqa: BLE001 - one bad profile is not fatal
                logger.warning("Could not scrape %s: %s", url, exc)
                await self._log("warn", "profile_error", f"Could not read {url}; skipped.")
                return None

        return None

    async def _scrape_profile(
        self,
        url: str,
        params: SearchParams,
        location: object,
    ) -> ScrapedLead | None:
        page = self._require_page()

        await page.goto(url, wait_until="domcontentloaded", timeout=self._config.timeout_ms)
        await self._pause(1.5, 3.0)
        html = await page.content()

        self._raise_if_blocked(page.url, html)
        self._requests_since_break += 1

        fields = parsing.parse_profile(html, url)
        full_name = fields.get("full_name")

        if not full_name:
            logger.debug("No name on %s; skipping", url)
            return None

        # Second-pass filters. LinkedIn's keyword search is loose, so a result
        # is not automatically a match.
        if not parsing.title_matches(fields.get("job_title"), params.job_titles):
            logger.debug("Title mismatch on %s; skipping", url)
            return None

        text_matches = getattr(location, "text_matches", ())
        if not location_text_matches(fields.get("location"), text_matches):
            logger.debug("Location mismatch on %s; skipping", url)
            return None

        return ScrapedLead(
            full_name=full_name,
            linkedin_url=fields.get("linkedin_url"),
            job_title=fields.get("job_title"),
            company_name=fields.get("company_name"),
            company_website=fields.get("company_website"),
            company_linkedin_url=fields.get("company_linkedin_url"),
            location=fields.get("location"),
            country=getattr(location, "country_name", None),
            industry=params.industry if params.industry != "all" else None,
            company_size=params.company_size if params.company_size != "any" else None,
            email=fields.get("email"),
            phone=fields.get("phone"),
            mobile_phone=None,
            source="linkedin",
            source_url=fields.get("source_url"),
        )

    # -- helpers -------------------------------------------------------------

    def _require_page(self) -> Page:
        if self._page is None:
            raise RuntimeError("Scraper used before start() was called")
        return self._page

    @staticmethod
    def _raise_if_blocked(url: str, html: str) -> None:
        block = parsing.detect_block(url, html)
        if block == "challenge":
            raise ScraperStop(
                JobErrorCode.REQUIRES_VERIFICATION,
                "LinkedIn asked for a verification step that has to be completed by a person.",
            )
        if block == "auth_wall":
            raise ScraperStop(
                JobErrorCode.AUTH_WALL,
                "LinkedIn served a sign-in wall. The scraper session is no longer valid.",
            )

    @staticmethod
    async def _pause(minimum: float, maximum: float) -> None:
        await asyncio.sleep(random.uniform(minimum, max(minimum, maximum)))

    async def _maybe_take_break(self) -> None:
        """Idles for a while after a run of requests, then continues."""
        if self._config.break_every_n_requests <= 0:
            return
        if self._requests_since_break < self._config.break_every_n_requests:
            return

        self._requests_since_break = 0
        seconds = random.uniform(45, 120)
        logger.info("Taking a %.0fs break", seconds, extra={"event": "session_break"})
        await self._log("info", "session_break", f"Pausing for {seconds:.0f}s to stay well within rate limits.")
        await asyncio.sleep(seconds)

    async def _log(self, level: str, event: str, message: str) -> None:
        if self._on_log is not None:
            await self._on_log(level, event, message)
