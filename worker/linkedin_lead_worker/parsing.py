"""HTML extraction for LinkedIn profile and search pages.

Ported from the upstream project's BeautifulSoup extractors
(yagyeshVyas/linkedin-scraper, linkedin_scraper.py) and reworked into pure
functions that take HTML and return values. Nothing here touches a browser, so
every rule below is covered by tests against fixture HTML.

Two deliberate changes from upstream:

  * Contact fields return None rather than "" when nothing is published, so a
    missing value stays missing all the way into the database instead of being
    stored as an empty string that looks like a real answer.

  * The phone extractor no longer scrapes free text for anything that looks
    like a US number. That produced false positives from post counts and dates.
    Only an explicit tel: link counts.
"""

from __future__ import annotations

import re
from typing import Iterable
from urllib.parse import urlencode

from bs4 import BeautifulSoup

# ---------------------------------------------------------------------------
#  Search URLs
# ---------------------------------------------------------------------------

LINKEDIN_PEOPLE_SEARCH = "https://www.linkedin.com/search/results/people/"


def build_people_search_url(
    job_title: str,
    geo_urn: str | None = None,
    extra_keywords: Iterable[str] = (),
    page: int = 1,
) -> str:
    """Builds a LinkedIn people-search URL.

    Quoting the title makes LinkedIn match the phrase rather than the loose
    union of its words, which is the difference between "Finance Director" and
    every profile mentioning finance.

    When geo_urn is None the location cannot be filtered server-side; callers
    fall back to matching the location text on each profile instead.
    """
    keywords = f'"{job_title}"'
    for extra in extra_keywords:
        if extra:
            keywords += f' "{extra}"'

    params: dict[str, str] = {"keywords": keywords, "origin": "GLOBAL_SEARCH_HEADER"}
    if geo_urn:
        params["geoUrn"] = f'["{geo_urn}"]'

    url = f"{LINKEDIN_PEOPLE_SEARCH}?{urlencode(params)}"
    if page > 1:
        url += f"&page={page}"
    return url


PROFILE_URL_RE = re.compile(r"/in/[^/?#]+")


def extract_profile_urls(html: str) -> list[str]:
    """Pulls unique, canonical /in/ profile URLs out of a search results page."""
    soup = BeautifulSoup(html, "html.parser")
    seen: dict[str, None] = {}

    for anchor in soup.select("a[href]"):
        href = anchor.get("href")
        if not isinstance(href, str) or "/in/" not in href:
            continue

        match = PROFILE_URL_RE.search(href)
        if not match:
            continue

        path = match.group(0).rstrip("/")
        # Skip LinkedIn's own non-profile paths that share the /in/ prefix.
        if path in {"/in", "/in/unavailable"}:
            continue
        seen.setdefault(f"https://www.linkedin.com{path}", None)

    return list(seen)


def has_no_results(html: str) -> bool:
    """True when LinkedIn reported an empty result set rather than an error."""
    lowered = html.lower()
    return "no results found" in lowered or "no results for" in lowered


# ---------------------------------------------------------------------------
#  Block / challenge detection
#
#  These are read-only checks. When one fires the worker stops and reports a
#  clear status to the user; it never tries to solve or work around the
#  challenge.
# ---------------------------------------------------------------------------

CHALLENGE_URL_MARKERS = ("checkpoint", "challenge", "verification", "captcha")
AUTH_WALL_URL_MARKERS = ("authwall", "/uas/login", "/login")


def detect_block(url: str, html: str) -> str | None:
    """Returns 'challenge', 'auth_wall' or None."""
    lowered_url = url.lower()

    if any(marker in lowered_url for marker in CHALLENGE_URL_MARKERS):
        return "challenge"

    if any(marker in lowered_url for marker in AUTH_WALL_URL_MARKERS):
        return "auth_wall"

    lowered_html = html.lower()
    if "authwall" in lowered_html or "sign in to linkedin" in lowered_html:
        return "auth_wall"

    # Matched on fragments that avoid the apostrophe, because LinkedIn serves
    # it raw in some responses and HTML-escaped ("&#x27;") in others.
    challenge_markers = (
        "security verification",
        "quick security check",
        "verify you are a human",
        "please complete this security check",
    )
    if any(marker in lowered_html for marker in challenge_markers):
        return "challenge"

    return None


# ---------------------------------------------------------------------------
#  Profile field extraction
# ---------------------------------------------------------------------------


def _text_or_none(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = " ".join(value.split())
    return cleaned or None


def extract_name(soup: BeautifulSoup) -> str | None:
    for selector in ("h1.text-heading-xlarge", "h1.inline.t-24", "h1"):
        element = soup.select_one(selector)
        if element:
            name = _text_or_none(element.get_text(strip=True))
            if name:
                return name
    return None


def extract_headline(soup: BeautifulSoup) -> str | None:
    for selector in (
        ".text-body-medium.break-words",
        ".pv-top-card--experience-list-item",
        "div.top-card-layout__headline",
    ):
        element = soup.select_one(selector)
        if element:
            headline = _text_or_none(element.get_text(strip=True))
            if headline:
                return headline
    return None


def extract_current_title(soup: BeautifulSoup) -> str | None:
    """Takes the part of the headline before 'at' or a pipe separator."""
    headline = extract_headline(soup)
    if not headline:
        return None
    parts = re.split(r"\s+(?:at|hos|@)\s+|\s*[|·]\s*", headline, maxsplit=1)
    return _text_or_none(parts[0]) if parts else None


def extract_current_company(soup: BeautifulSoup) -> str | None:
    """Prefers the experience section; falls back to the headline's 'at' clause."""
    experience = soup.find("section", {"id": "experience"})
    if experience:
        element = experience.select_one(".pv-entity__secondary-title, .t-14.t-normal")
        if element:
            company = _text_or_none(element.get_text(strip=True))
            if company:
                return company

    element = soup.select_one(
        ".pv-top-card--experience-list .pv-top-card--experience-list-item"
    )
    if element:
        company = _text_or_none(element.get_text(strip=True))
        if company:
            return company

    headline = extract_headline(soup)
    if headline:
        match = re.search(r"\s+(?:at|hos|@)\s+(.+)$", headline)
        if match:
            # Trim a trailing clause after a separator, e.g. "Acme | Investor".
            return _text_or_none(re.split(r"\s*[|·]\s*", match.group(1))[0])

    return None


def extract_location(soup: BeautifulSoup) -> str | None:
    """LinkedIn renders the location in a small muted line near the headline."""
    for selector in (
        ".text-body-small.inline.t-black--light.break-words",
        "div.top-card-layout__first-subline",
        ".pv-top-card--list-bullet li",
    ):
        for element in soup.select(selector):
            text = _text_or_none(element.get_text(strip=True))
            # Rule out follower/connection counts that share the same styling.
            if not text or len(text) > 80:
                continue
            if re.search(r"\d+\s*(followers?|connections?|følgere)", text, re.IGNORECASE):
                continue
            if "," in text or text.isalpha():
                return text
    return None


# Domains that produce email-shaped strings which are never a person's address.
EMAIL_JUNK_DOMAINS = (
    "linkedin.com",
    "licdn.com",
    "sentry.io",
    "example.com",
    "gstatic.com",
    "w3.org",
    "schema.org",
    "play.google.com",
    "microsoft.com",
    "google.com",
    "github.com",
    "sentry-cdn.com",
)

EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")


def extract_email(soup: BeautifulSoup) -> str | None:
    """Returns a published contact address, or None.

    Prefers an explicit mailto: link. The text fallback exists because LinkedIn
    sometimes renders the contact-info address as plain text, and it filters
    hard: asset hashes, tracking domains and framework addresses all look like
    emails in a raw page dump.
    """
    mailto = soup.select_one('a[href^="mailto:"]')
    if mailto:
        href = mailto.get("href")
        if isinstance(href, str):
            address = href[len("mailto:") :].split("?")[0].strip()
            if address and "@" in address and _is_plausible_email(address):
                return address.lower()

    for candidate in EMAIL_RE.findall(soup.get_text(" ")):
        if _is_plausible_email(candidate):
            return candidate.lower()

    return None


def _is_plausible_email(address: str) -> bool:
    local, _, domain = address.partition("@")
    if not local or not domain:
        return False
    lowered = domain.lower()
    if any(junk in lowered for junk in EMAIL_JUNK_DOMAINS):
        return False
    # Image hashes render as "123456@2x.png".
    if local.isdigit():
        return False
    if lowered.endswith((".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp")):
        return False
    return True


def extract_phone(soup: BeautifulSoup) -> str | None:
    """Returns a published phone number, or None.

    Only an explicit tel: link counts. Upstream scanned page text with a US
    number pattern, which matched post counts, dates and ids far more often
    than real numbers — and a wrong phone number in a dialer is worse than no
    number at all.
    """
    tel = soup.select_one('a[href^="tel:"]')
    if tel:
        href = tel.get("href")
        if isinstance(href, str):
            number = href[len("tel:") :].strip()
            if number:
                return number
    return None


def extract_company_website(soup: BeautifulSoup) -> str | None:
    """Finds an outbound company link, ignoring LinkedIn's own domains."""
    for anchor in soup.select('a[href^="http"]'):
        href = anchor.get("href")
        if not isinstance(href, str):
            continue
        lowered = href.lower()
        if "linkedin.com" in lowered or "licdn.com" in lowered:
            continue
        if lowered.startswith(("http://", "https://")):
            return href
    return None


def extract_company_linkedin_url(soup: BeautifulSoup) -> str | None:
    for anchor in soup.select('a[href*="/company/"]'):
        href = anchor.get("href")
        if not isinstance(href, str):
            continue
        match = re.search(r"/company/[^/?#]+", href)
        if match:
            return f"https://www.linkedin.com{match.group(0).rstrip('/')}"
    return None


def parse_profile(html: str, profile_url: str) -> dict[str, str | None]:
    """Extracts every supported field from a profile page.

    Returns a plain dict so the caller decides what to do with a profile that
    is missing a name — this function does not raise on incomplete pages.
    """
    soup = BeautifulSoup(html, "html.parser")
    return {
        "full_name": extract_name(soup),
        "job_title": extract_current_title(soup),
        "company_name": extract_current_company(soup),
        "company_website": extract_company_website(soup),
        "company_linkedin_url": extract_company_linkedin_url(soup),
        "location": extract_location(soup),
        "email": extract_email(soup),
        "phone": extract_phone(soup),
        "linkedin_url": profile_url,
        "source_url": profile_url,
    }


# ---------------------------------------------------------------------------
#  Post-filtering
# ---------------------------------------------------------------------------


def title_matches(job_title: str | None, wanted_titles: Iterable[str]) -> bool:
    """True when the scraped title plausibly matches one of the requested ones.

    LinkedIn's keyword search is fuzzy, so a search for "CFO" returns people
    whose title is something else entirely. This is the second pass.
    """
    if not job_title:
        return False
    haystack = job_title.lower()
    return any(wanted.lower() in haystack for wanted in wanted_titles if wanted)


def location_matches(location: str | None, wanted: str) -> bool:
    """Loose location match, used when a city has no verified LinkedIn geo id.

    'all' and an empty value accept everything — a country-level geoUrn has
    already narrowed the search server-side by that point.
    """
    if wanted in ("", "all"):
        return True
    if not location:
        return False
    return wanted.strip().lower() in location.lower()
