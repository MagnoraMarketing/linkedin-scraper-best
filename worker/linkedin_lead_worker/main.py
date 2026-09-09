"""Worker entrypoint.

Polls Supabase for queued jobs and runs them one at a time. Restart-safe: a
job whose worker dies is re-claimed after its heartbeat goes stale, and the
database's unique indexes make re-running it produce no duplicates.

Run with:  python -m linkedin_lead_worker.main
"""

from __future__ import annotations

import asyncio
import logging
import signal
import sys

from .config import ConfigError, load_config
from .logging_setup import setup_logging
from .runner import JobRunner
from .supabase_client import SupabaseClient, SupabaseError

logger = logging.getLogger(__name__)


async def run_worker() -> int:
    try:
        config = load_config()
        config.validate()
    except ConfigError as exc:
        # Logging is not configured yet, and this message names only variable
        # names, never values.
        print(f"Configuration error: {exc}", file=sys.stderr)
        return 2

    setup_logging(config.secret_values())

    logger.info(
        "Worker starting",
        extra={
            "event": "worker_start",
            "worker_id": config.worker_id,
        },
    )
    logger.info(
        "Rate limiting: concurrency=%s delay=%sms timeout=%sms retries=%s",
        config.max_concurrency,
        config.delay_ms,
        config.timeout_ms,
        config.max_retries,
    )

    shutdown = asyncio.Event()

    def request_shutdown() -> None:
        if not shutdown.is_set():
            logger.info("Shutdown requested; finishing the current job")
            shutdown.set()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, request_shutdown)
        except NotImplementedError:
            # Signal handlers are unavailable on some platforms (Windows).
            pass

    async with SupabaseClient(config.supabase_url, config.supabase_service_role_key) as supabase:
        runner = JobRunner(config, supabase)

        while not shutdown.is_set():
            try:
                job = await supabase.claim_next_job(config.worker_id)
            except SupabaseError as exc:
                logger.error("Could not reach the job queue: %s", exc)
                await _sleep_or_shutdown(shutdown, config.poll_interval_seconds)
                continue

            if job is None:
                await _sleep_or_shutdown(shutdown, config.poll_interval_seconds)
                continue

            try:
                await runner.run(job)
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001 - the loop must survive any job
                logger.exception("Job runner raised; continuing with the next job")

    logger.info("Worker stopped", extra={"event": "worker_stop"})
    return 0


async def _sleep_or_shutdown(shutdown: asyncio.Event, seconds: int) -> None:
    """Sleeps, but wakes immediately on a shutdown signal."""
    try:
        await asyncio.wait_for(shutdown.wait(), timeout=seconds)
    except asyncio.TimeoutError:
        pass


def main() -> None:
    try:
        sys.exit(asyncio.run(run_worker()))
    except KeyboardInterrupt:
        sys.exit(0)


if __name__ == "__main__":
    main()
