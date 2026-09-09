"""Runs one claimed job end to end.

Owns the lifecycle: start the browser, sign in, scrape, save each lead as it
arrives, publish progress, and record a terminal status. Everything that can
fail is turned into a status the UI can explain, rather than a stack trace.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from .config import Config
from .linkedin import LinkedInScraper
from .models import JobErrorCode, JobProgress, ScrapedLead, ScraperStop, SearchParams
from .supabase_client import SupabaseClient, SupabaseError

logger = logging.getLogger(__name__)


class JobRunner:
    def __init__(self, config: Config, supabase: SupabaseClient) -> None:
        self._config = config
        self._supabase = supabase

    async def run(self, job: dict[str, Any]) -> None:
        job_id = str(job["id"])
        user_id = str(job["user_id"])
        params = SearchParams.from_job_row(job)
        progress = JobProgress()
        last_heartbeat = 0.0
        cancelled = False

        log_extra = {"job_id": job_id, "worker_id": self._config.worker_id}
        logger.info("Job claimed", extra={**log_extra, "event": "job_claimed"})

        async def write_log(level: str, event: str, message: str) -> None:
            await self._supabase.log(job_id, user_id, event, message, level)

        async def publish(force: bool = False) -> bool:
            """Pushes progress and returns True when the job should stop."""
            nonlocal last_heartbeat
            now = time.monotonic()
            if not force and now - last_heartbeat < self._config.heartbeat_interval_seconds:
                return False
            last_heartbeat = now
            try:
                return await self._supabase.heartbeat(
                    job_id,
                    self._config.worker_id,
                    found=progress.found,
                    duplicates=progress.duplicates,
                    processed=progress.processed,
                )
            except SupabaseError as exc:
                # A failed heartbeat is not a reason to throw away work in
                # progress; the next one will most likely land.
                logger.warning("Heartbeat failed: %s", exc, extra=log_extra)
                return False

        async def on_lead(lead: ScrapedLead) -> bool:
            """Saves one lead. Returns False to stop the run."""
            nonlocal cancelled
            progress.processed += 1

            try:
                _, action = await self._supabase.upsert_lead(
                    lead.to_upsert_args(user_id, job_id)
                )
            except SupabaseError as exc:
                logger.warning("Could not save lead: %s", exc, extra=log_extra)
                await write_log("warn", "lead_save_failed", "One lead could not be saved; continuing.")
                return True

            if action == "inserted":
                progress.found += 1
            else:
                progress.duplicates += 1
                logger.debug("Duplicate merged", extra=log_extra)

            # Publish immediately on the first few leads so the progress bar
            # moves right away, then settle into the heartbeat interval.
            should_stop = await publish(force=progress.found <= 3)
            if should_stop:
                cancelled = True
                return False

            return progress.found < params.limit

        try:
            await write_log("info", "job_started", "Starting the search.")

            # Skip profiles already in the database: avoids page loads whose
            # result would only be discarded as a duplicate.
            skip_urls = await self._supabase.existing_linkedin_urls(user_id)
            if skip_urls:
                await write_log(
                    "info",
                    "known_leads",
                    f"{len(skip_urls)} profiles are already in your database and will be skipped.",
                )

            async with LinkedInScraper(self._config) as scraper:
                await scraper.login()
                await scraper.run_search(
                    params, on_lead=on_lead, skip_urls=skip_urls, on_log=write_log
                )

            await publish(force=True)

            if cancelled:
                await self._finish(job_id, "cancelled", None, None)
                await write_log(
                    "info",
                    "job_cancelled",
                    f"Cancelled. {progress.found} leads were saved before stopping.",
                )
                logger.info("Job cancelled", extra={**log_extra, "event": "job_cancelled"})
                return

            await self._finish(job_id, "completed", None, None)
            await write_log(
                "info",
                "job_completed",
                f"Completed. {progress.found} leads found, "
                f"{progress.duplicates} duplicates skipped, "
                f"{progress.processed} profiles processed.",
            )
            logger.info(
                "Job completed",
                extra={**log_extra, "event": "job_completed"},
            )

        except ScraperStop as stop:
            await publish(force=True)

            # Cancelling mid-run can surface as "no results"; report the cancel.
            if cancelled:
                await self._finish(job_id, "cancelled", None, None)
                await write_log("info", "job_cancelled", "Cancelled by the user.")
                return

            # Finding nothing after saving leads is a completed run, not a failure.
            if stop.code is JobErrorCode.NO_RESULTS and progress.found > 0:
                await self._finish(job_id, "completed", None, None)
                await write_log(
                    "info", "job_completed", f"Completed with {progress.found} leads."
                )
                return

            await self._finish(job_id, "failed", stop.message, stop.code.value)
            await write_log("error", "job_failed", stop.message)
            logger.warning(
                "Job failed: %s", stop.message, extra={**log_extra, "event": "job_failed"}
            )

        except asyncio.CancelledError:
            # The worker is shutting down. Leave the job running so another
            # worker can re-claim it once the heartbeat goes stale.
            logger.info("Job interrupted by shutdown", extra=log_extra)
            raise

        except Exception as exc:  # noqa: BLE001 - a job must never kill the worker
            logger.exception("Unexpected error running job", extra=log_extra)
            await self._finish(
                job_id,
                "failed",
                "The scraper hit an unexpected error and stopped.",
                JobErrorCode.WORKER_ERROR.value,
            )
            # The exception text can carry internal detail, so it goes to the
            # server log only — the job log gets the generic message above.
            logger.debug("Job error detail: %s", exc, extra=log_extra)

    async def _finish(
        self,
        job_id: str,
        status: str,
        error_message: str | None,
        error_code: str | None,
    ) -> None:
        try:
            await self._supabase.finish_job(
                job_id, self._config.worker_id, status, error_message, error_code
            )
        except SupabaseError as exc:
            # If this fails the heartbeat stops too, and the job is re-claimed
            # as stale after five minutes — safe, because leads are deduplicated.
            logger.error("Could not record the job's final status: %s", exc)
