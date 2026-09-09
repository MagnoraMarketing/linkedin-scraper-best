"""Worker configuration, read entirely from the environment.

No credential is ever hard-coded, defaulted to a real value, or written to
disk by this module. Defaults for the rate-limiting knobs are deliberately
conservative — raising them increases the chance of tripping LinkedIn's own
protections, which this worker treats as a hard stop rather than an obstacle.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


def _env_str(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name, "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


class ConfigError(RuntimeError):
    """Raised when required configuration is missing."""


@dataclass(frozen=True)
class Config:
    # --- Supabase -----------------------------------------------------------
    supabase_url: str = field(default_factory=lambda: _env_str("NEXT_PUBLIC_SUPABASE_URL"))
    supabase_service_role_key: str = field(
        default_factory=lambda: _env_str("SUPABASE_SERVICE_ROLE_KEY")
    )

    # --- LinkedIn credentials ----------------------------------------------
    linkedin_email: str = field(default_factory=lambda: _env_str("LINKEDIN_EMAIL"))
    linkedin_password: str = field(default_factory=lambda: _env_str("LINKEDIN_PASSWORD"))

    # --- Rate limiting ------------------------------------------------------
    max_concurrency: int = field(default_factory=lambda: _env_int("SCRAPER_MAX_CONCURRENCY", 1))
    delay_ms: int = field(default_factory=lambda: _env_int("SCRAPER_DELAY_MS", 8000))
    timeout_ms: int = field(default_factory=lambda: _env_int("SCRAPER_TIMEOUT_MS", 30000))
    max_retries: int = field(default_factory=lambda: _env_int("SCRAPER_MAX_RETRIES", 3))
    max_search_pages: int = field(default_factory=lambda: _env_int("SCRAPER_MAX_SEARCH_PAGES", 10))
    break_every_n_requests: int = field(
        default_factory=lambda: _env_int("SCRAPER_BREAK_EVERY_N_REQUESTS", 15)
    )

    # --- Worker runtime -----------------------------------------------------
    poll_interval_seconds: int = field(
        default_factory=lambda: _env_int("SCRAPER_POLL_INTERVAL_SECONDS", 10)
    )
    headless: bool = field(default_factory=lambda: _env_bool("SCRAPER_HEADLESS", True))
    session_dir: str = field(default_factory=lambda: _env_str("SCRAPER_SESSION_DIR", ".session"))
    worker_id: str = field(default_factory=lambda: _env_str("SCRAPER_WORKER_ID", "worker-1"))

    # Heartbeat cadence. Must stay well under the 5-minute staleness window the
    # database uses to decide a job has been abandoned.
    heartbeat_interval_seconds: int = 30

    @property
    def min_delay_seconds(self) -> float:
        return max(self.delay_ms, 0) / 1000.0

    @property
    def max_delay_seconds(self) -> float:
        """Upper bound of the randomised inter-profile delay."""
        return self.min_delay_seconds * 2.25

    @property
    def session_path(self) -> Path:
        return Path(self.session_dir)

    def secret_values(self) -> list[str]:
        """Values the logger must redact before anything is emitted."""
        return [
            value
            for value in (self.linkedin_password, self.supabase_service_role_key)
            if value
        ]

    def validate(self) -> None:
        missing: list[str] = []
        if not self.supabase_url:
            missing.append("NEXT_PUBLIC_SUPABASE_URL")
        if not self.supabase_service_role_key:
            missing.append("SUPABASE_SERVICE_ROLE_KEY")
        if not self.linkedin_email:
            missing.append("LINKEDIN_EMAIL")
        if not self.linkedin_password:
            missing.append("LINKEDIN_PASSWORD")

        if missing:
            raise ConfigError(
                "Missing required environment variables: " + ", ".join(missing)
            )

        if self.max_concurrency < 1:
            raise ConfigError("SCRAPER_MAX_CONCURRENCY must be at least 1")
        if self.max_concurrency > 3:
            raise ConfigError(
                "SCRAPER_MAX_CONCURRENCY above 3 is not supported: parallel profile loads "
                "from one account are exactly the pattern LinkedIn rate-limits."
            )


def load_config() -> Config:
    return Config()
