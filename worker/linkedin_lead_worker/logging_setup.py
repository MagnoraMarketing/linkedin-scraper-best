"""Structured logging with secret redaction.

Every record passes through RedactingFilter before a handler sees it, so a
password or service-role key cannot reach stdout or a log file even if it is
accidentally interpolated into a message or an exception string.
"""

from __future__ import annotations

import json
import logging
import sys
from typing import Iterable

REDACTED = "[REDACTED]"

# Substrings that mark a value as sensitive regardless of where it came from.
SENSITIVE_KEY_HINTS = (
    "password",
    "passwd",
    "secret",
    "token",
    "api_key",
    "apikey",
    "service_role",
    "authorization",
    "cookie",
    "session",
    "bearer",
)


class RedactingFilter(logging.Filter):
    """Replaces known secret values anywhere in a log record."""

    def __init__(self, secrets: Iterable[str]) -> None:
        super().__init__()
        # Sort longest-first so a key that contains another is replaced whole.
        self._secrets = sorted(
            {s for s in secrets if s and len(s) >= 4}, key=len, reverse=True
        )

    def _scrub(self, text: str) -> str:
        for secret in self._secrets:
            if secret in text:
                text = text.replace(secret, REDACTED)
        return text

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str):
            record.msg = self._scrub(record.msg)
        if record.args:
            if isinstance(record.args, dict):
                record.args = {
                    k: self._scrub(v) if isinstance(v, str) else v
                    for k, v in record.args.items()
                }
            elif isinstance(record.args, tuple):
                record.args = tuple(
                    self._scrub(a) if isinstance(a, str) else a for a in record.args
                )
        if record.exc_info and record.exc_info[1] is not None:
            exc = record.exc_info[1]
            scrubbed = self._scrub(str(exc))
            if scrubbed != str(exc):
                # Rebuild the exception with a scrubbed message; the traceback
                # frames themselves never carry the literal value.
                record.exc_info = (record.exc_info[0], type(exc)(scrubbed), record.exc_info[2])
        return True


class JsonFormatter(logging.Formatter):
    """One JSON object per line — greppable, and safe to ship to a log service."""

    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S"),
            "level": record.levelname.lower(),
            "logger": record.name,
            "message": record.getMessage(),
        }
        for key in ("job_id", "event", "worker_id"):
            value = getattr(record, key, None)
            if value is not None:
                payload[key] = value
        if record.exc_info:
            payload["error"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


def redact_mapping(data: dict[str, object]) -> dict[str, object]:
    """Masks values whose key name suggests a secret. Used before logging config."""
    out: dict[str, object] = {}
    for key, value in data.items():
        if any(hint in key.lower() for hint in SENSITIVE_KEY_HINTS):
            out[key] = REDACTED
        else:
            out[key] = value
    return out


def setup_logging(secrets: Iterable[str], level: int = logging.INFO) -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    handler.addFilter(RedactingFilter(secrets))

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level)

    # Playwright and httpx are chatty at DEBUG and can echo request headers.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
