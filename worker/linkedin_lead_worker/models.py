"""Data structures shared between the scraper and the rest of the worker.

This module is the interface between the scraper and everything else: give it
SearchParams, get back ScrapedLead objects. Nothing here imports Playwright, so
these types can be constructed and tested without a browser.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class JobErrorCode(str, Enum):
    """Machine-readable failure reasons. The UI maps these to user-facing help."""

    LOGIN_FAILED = "login_failed"
    REQUIRES_VERIFICATION = "requires_verification"
    AUTH_WALL = "auth_wall"
    NO_RESULTS = "no_results"
    TIMEOUT = "timeout"
    WORKER_ERROR = "worker_error"


class ScraperStop(Exception):
    """Raised when a job cannot continue. Carries a code the UI understands."""

    def __init__(self, code: JobErrorCode, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class SearchParams:
    """Everything the scraper needs to run one job."""

    job_titles: list[str]
    country: str
    location: str = "all"
    company_size: str = "any"
    industry: str = "all"
    limit: int = 25

    @classmethod
    def from_job_row(cls, row: dict[str, Any]) -> "SearchParams":
        return cls(
            job_titles=list(row.get("job_titles") or []),
            country=row.get("country") or "DK",
            location=row.get("location") or "all",
            company_size=row.get("company_size") or "any",
            industry=row.get("industry") or "all",
            limit=int(row.get("requested_count") or 25),
        )


@dataclass
class ScrapedLead:
    """One profile, normalised.

    Every contact field defaults to None. The scraper writes a value only when
    LinkedIn actually published one — it never derives an address from a name
    and a domain, and never generates a phone number.
    """

    full_name: str
    linkedin_url: str | None = None
    job_title: str | None = None
    company_name: str | None = None
    company_website: str | None = None
    company_linkedin_url: str | None = None
    location: str | None = None
    country: str | None = None
    industry: str | None = None
    company_size: str | None = None
    email: str | None = None
    phone: str | None = None
    mobile_phone: str | None = None
    source: str = "linkedin"
    source_url: str | None = None
    first_name: str | None = None
    last_name: str | None = None

    def __post_init__(self) -> None:
        if self.first_name is None and self.last_name is None:
            self.first_name, self.last_name = split_name(self.full_name)

    def to_upsert_args(self, user_id: str, job_id: str) -> dict[str, Any]:
        """Arguments for the upsert_lead() database function."""
        return {
            "p_user_id": user_id,
            "p_job_id": job_id,
            "p_full_name": self.full_name,
            "p_first_name": self.first_name,
            "p_last_name": self.last_name,
            "p_job_title": self.job_title,
            "p_company_name": self.company_name,
            "p_company_website": self.company_website,
            "p_company_linkedin_url": self.company_linkedin_url,
            "p_linkedin_url": self.linkedin_url,
            "p_location": self.location,
            "p_country": self.country,
            "p_industry": self.industry,
            "p_company_size": self.company_size,
            "p_email": self.email,
            "p_phone": self.phone,
            "p_mobile_phone": self.mobile_phone,
            "p_source": self.source,
            "p_source_url": self.source_url,
        }


def split_name(full_name: str) -> tuple[str | None, str | None]:
    """Splits a display name; everything after the first token is the surname."""
    parts = [p for p in full_name.strip().split() if p]
    if not parts:
        return None, None
    if len(parts) == 1:
        return parts[0], None
    return parts[0], " ".join(parts[1:])


@dataclass
class JobProgress:
    """Running totals reported back to the database on each heartbeat."""

    found: int = 0
    duplicates: int = 0
    processed: int = 0
    errors: list[str] = field(default_factory=list)
