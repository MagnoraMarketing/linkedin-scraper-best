"""Supabase REST client for the worker.

Uses the service role key, so it bypasses RLS. Every call goes through one of
the SECURITY DEFINER functions defined in supabase/migrations/0003_job_queue.sql
rather than writing tables directly — that keeps the worker's write surface
small and keeps the duplicate-detection logic in one place.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)


class SupabaseError(RuntimeError):
    """A Supabase call failed. The message never carries the API key."""


class SupabaseClient:
    def __init__(self, url: str, service_role_key: str, timeout: float = 30.0) -> None:
        self._base_url = url.rstrip("/")
        self._client = httpx.AsyncClient(
            base_url=f"{self._base_url}/rest/v1",
            headers={
                "apikey": service_role_key,
                "Authorization": f"Bearer {service_role_key}",
                "Content-Type": "application/json",
                "Prefer": "return=representation",
            },
            timeout=timeout,
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def __aenter__(self) -> "SupabaseClient":
        return self

    async def __aexit__(self, *_: object) -> None:
        await self.aclose()

    async def _rpc(self, function: str, payload: dict[str, Any]) -> Any:
        try:
            response = await self._client.post(f"/rpc/{function}", json=payload)
        except httpx.HTTPError as exc:
            raise SupabaseError(f"Could not reach Supabase calling {function}: {exc}") from exc

        if response.status_code >= 400:
            # Include the status and PostgREST's message, never the request headers.
            raise SupabaseError(
                f"Supabase rejected {function} with {response.status_code}: {response.text[:300]}"
            )

        if not response.content:
            return None
        return response.json()

    # -- queue ---------------------------------------------------------------

    async def claim_next_job(self, worker_id: str) -> dict[str, Any] | None:
        """Atomically claims the oldest queued (or abandoned) job."""
        rows = await self._rpc("claim_next_job", {"p_worker_id": worker_id})
        if isinstance(rows, list) and rows:
            first = rows[0]
            return first if isinstance(first, dict) else None
        return None

    async def heartbeat(
        self,
        job_id: str,
        worker_id: str,
        found: int | None = None,
        duplicates: int | None = None,
        processed: int | None = None,
    ) -> bool:
        """Publishes progress. Returns True when the job should stop.

        True means either the user cancelled it or this worker lost the claim —
        both are reasons to put the browser down and move on.
        """
        result = await self._rpc(
            "job_heartbeat",
            {
                "p_job_id": job_id,
                "p_worker_id": worker_id,
                "p_found_count": found,
                "p_duplicate_count": duplicates,
                "p_processed_count": processed,
            },
        )
        return bool(result)

    async def finish_job(
        self,
        job_id: str,
        worker_id: str,
        status: str,
        error_message: str | None = None,
        error_code: str | None = None,
    ) -> None:
        await self._rpc(
            "finish_job",
            {
                "p_job_id": job_id,
                "p_worker_id": worker_id,
                "p_status": status,
                "p_error_message": error_message,
                "p_error_code": error_code,
            },
        )

    # -- leads ---------------------------------------------------------------

    async def upsert_lead(self, args: dict[str, Any]) -> tuple[str | None, str]:
        """Inserts or merges a lead. Returns (lead_id, 'inserted' | 'updated')."""
        result = await self._rpc("upsert_lead", args)

        if isinstance(result, dict):
            return result.get("lead_id"), str(result.get("action") or "inserted")
        if isinstance(result, list) and result and isinstance(result[0], dict):
            row = result[0]
            return row.get("lead_id"), str(row.get("action") or "inserted")

        raise SupabaseError("upsert_lead returned an unexpected shape")

    async def existing_linkedin_urls(self, user_id: str) -> set[str]:
        """The user's already-known profile URLs.

        Lets the worker skip a profile page load it would only discard, which
        matters more than the query costs: every page load is rate-limit budget.
        """
        try:
            response = await self._client.get(
                "/leads",
                params={
                    "select": "linkedin_url",
                    "user_id": f"eq.{user_id}",
                    "linkedin_url": "not.is.null",
                    "limit": "10000",
                },
            )
            response.raise_for_status()
        except httpx.HTTPError as exc:
            logger.warning("Could not preload existing leads: %s", exc)
            return set()

        return {
            row["linkedin_url"].rstrip("/").lower()
            for row in response.json()
            if isinstance(row, dict) and row.get("linkedin_url")
        }

    # -- logs ----------------------------------------------------------------

    async def log(
        self,
        job_id: str,
        user_id: str,
        event: str,
        message: str | None = None,
        level: str = "info",
    ) -> None:
        """Writes one run-log line.

        Log failures are swallowed: losing a log line must never fail the job
        that produced it.
        """
        try:
            await self._client.post(
                "/job_logs",
                json={
                    "job_id": job_id,
                    "user_id": user_id,
                    "event": event,
                    "message": message,
                    "level": level,
                },
                headers={"Prefer": "return=minimal"},
            )
        except httpx.HTTPError as exc:
            logger.warning("Could not write job log: %s", exc)
