"""Config validation and, most importantly, that secrets never reach a log."""

import json
import logging

import pytest

from linkedin_lead_worker.config import Config, ConfigError
from linkedin_lead_worker.logging_setup import (
    REDACTED,
    JsonFormatter,
    RedactingFilter,
    redact_mapping,
)
from linkedin_lead_worker.models import ScrapedLead, SearchParams, split_name


BASE_ENV = {
    "NEXT_PUBLIC_SUPABASE_URL": "https://project.supabase.co",
    "SUPABASE_SERVICE_ROLE_KEY": "service-role-key-value",
    "LINKEDIN_EMAIL": "scraper@example.com",
    "LINKEDIN_PASSWORD": "correct-horse-battery",
}


@pytest.fixture
def env(monkeypatch):
    for key, value in BASE_ENV.items():
        monkeypatch.setenv(key, value)
    for key in (
        "SCRAPER_MAX_CONCURRENCY",
        "SCRAPER_DELAY_MS",
        "SCRAPER_TIMEOUT_MS",
        "SCRAPER_MAX_RETRIES",
        "SCRAPER_HEADLESS",
    ):
        monkeypatch.delenv(key, raising=False)
    return monkeypatch


# ---------------------------------------------------------------------------
#  Configuration
# ---------------------------------------------------------------------------


def test_defaults_are_conservative(env):
    config = Config()
    config.validate()

    assert config.max_concurrency == 1
    assert config.delay_ms == 8000
    assert config.max_retries == 3
    assert config.headless is True
    # The randomised delay must always be a real pause.
    assert config.min_delay_seconds == 8.0
    assert config.max_delay_seconds > config.min_delay_seconds


def test_missing_credentials_are_reported_by_name(env):
    env.delenv("LINKEDIN_PASSWORD")
    env.delenv("SUPABASE_SERVICE_ROLE_KEY")

    with pytest.raises(ConfigError) as excinfo:
        Config().validate()

    message = str(excinfo.value)
    assert "LINKEDIN_PASSWORD" in message
    assert "SUPABASE_SERVICE_ROLE_KEY" in message
    # The error names variables, never values.
    assert BASE_ENV["LINKEDIN_PASSWORD"] not in message


def test_reckless_concurrency_is_refused(env):
    env.setenv("SCRAPER_MAX_CONCURRENCY", "10")
    with pytest.raises(ConfigError, match="not supported"):
        Config().validate()

    env.setenv("SCRAPER_MAX_CONCURRENCY", "0")
    with pytest.raises(ConfigError, match="at least 1"):
        Config().validate()


def test_invalid_numeric_env_falls_back_to_the_default(env):
    env.setenv("SCRAPER_DELAY_MS", "not-a-number")
    assert Config().delay_ms == 8000


def test_secret_values_lists_everything_that_must_be_redacted(env):
    secrets = Config().secret_values()
    assert BASE_ENV["LINKEDIN_PASSWORD"] in secrets
    assert BASE_ENV["SUPABASE_SERVICE_ROLE_KEY"] in secrets
    # The email is an identifier, not a secret, and is useful in logs.
    assert BASE_ENV["LINKEDIN_EMAIL"] not in secrets


# ---------------------------------------------------------------------------
#  Secret redaction — the check that matters most
# ---------------------------------------------------------------------------


def _record(message, args=(), exc_info=None):
    return logging.LogRecord(
        name="test", level=logging.INFO, pathname=__file__, lineno=1,
        msg=message, args=args, exc_info=exc_info,
    )


def test_password_in_a_log_message_is_redacted():
    filt = RedactingFilter([BASE_ENV["LINKEDIN_PASSWORD"]])
    record = _record(f"Signing in with {BASE_ENV['LINKEDIN_PASSWORD']}")

    filt.filter(record)

    assert BASE_ENV["LINKEDIN_PASSWORD"] not in record.getMessage()
    assert REDACTED in record.getMessage()


def test_secret_in_a_format_argument_is_redacted():
    filt = RedactingFilter([BASE_ENV["SUPABASE_SERVICE_ROLE_KEY"]])
    record = _record("Calling API with key %s", (BASE_ENV["SUPABASE_SERVICE_ROLE_KEY"],))

    filt.filter(record)

    assert BASE_ENV["SUPABASE_SERVICE_ROLE_KEY"] not in record.getMessage()


def test_secret_inside_an_exception_is_redacted():
    filt = RedactingFilter([BASE_ENV["LINKEDIN_PASSWORD"]])
    error = ValueError(f"login failed for password {BASE_ENV['LINKEDIN_PASSWORD']}")
    record = _record("boom", exc_info=(ValueError, error, None))

    filt.filter(record)

    assert record.exc_info is not None
    assert BASE_ENV["LINKEDIN_PASSWORD"] not in str(record.exc_info[1])


def test_short_values_are_not_redacted_so_logs_stay_readable():
    # A 3-character "secret" would blank out ordinary words everywhere.
    filt = RedactingFilter(["abc"])
    record = _record("abcdef is fine")
    filt.filter(record)
    assert "abcdef" in record.getMessage()


def test_redact_mapping_masks_by_key_name():
    masked = redact_mapping(
        {
            "linkedin_password": "hunter2",
            "SUPABASE_SERVICE_ROLE_KEY": "abc",
            "session_cookie": "xyz",
            "authorization": "Bearer abc",
            "worker_id": "worker-1",
            "delay_ms": 8000,
        }
    )

    assert masked["linkedin_password"] == REDACTED
    assert masked["SUPABASE_SERVICE_ROLE_KEY"] == REDACTED
    assert masked["session_cookie"] == REDACTED
    assert masked["authorization"] == REDACTED
    # Non-secret values survive, or the logs would be useless.
    assert masked["worker_id"] == "worker-1"
    assert masked["delay_ms"] == 8000


def test_json_formatter_emits_one_parseable_object():
    record = _record("job finished")
    record.job_id = "job-1"
    record.event = "job_completed"

    payload = json.loads(JsonFormatter().format(record))

    assert payload["message"] == "job finished"
    assert payload["job_id"] == "job-1"
    assert payload["event"] == "job_completed"
    assert payload["level"] == "info"


# ---------------------------------------------------------------------------
#  Models
# ---------------------------------------------------------------------------


def test_search_params_from_a_job_row():
    params = SearchParams.from_job_row(
        {
            "job_titles": ["CFO", "CEO"],
            "country": "DK",
            "location": "copenhagen",
            "company_size": "50-100",
            "industry": "finance",
            "requested_count": 100,
        }
    )

    assert params.job_titles == ["CFO", "CEO"]
    assert params.limit == 100
    assert params.location == "copenhagen"


def test_search_params_tolerates_a_sparse_row():
    params = SearchParams.from_job_row({"job_titles": ["CFO"], "country": "DK"})
    assert params.location == "all"
    assert params.company_size == "any"
    assert params.limit == 25


def test_scraped_lead_defaults_contact_fields_to_none():
    # Nothing may be invented: a field LinkedIn did not publish stays null.
    lead = ScrapedLead(full_name="Jens Hansen")

    assert lead.email is None
    assert lead.phone is None
    assert lead.mobile_phone is None
    assert lead.company_website is None


def test_scraped_lead_splits_the_name():
    lead = ScrapedLead(full_name="Anne Marie Bak Sørensen")
    assert lead.first_name == "Anne"
    assert lead.last_name == "Marie Bak Sørensen"


def test_upsert_args_map_every_field_to_a_parameter():
    lead = ScrapedLead(
        full_name="Jens Hansen",
        job_title="CFO",
        company_name="Acme",
        linkedin_url="https://linkedin.com/in/jens",
    )

    args = lead.to_upsert_args("user-1", "job-1")

    assert args["p_user_id"] == "user-1"
    assert args["p_job_id"] == "job-1"
    assert args["p_full_name"] == "Jens Hansen"
    assert args["p_email"] is None
    assert args["p_source"] == "linkedin"


def test_split_name_edge_cases():
    assert split_name("Prince") == ("Prince", None)
    assert split_name("   ") == (None, None)
    assert split_name("Jens Hansen") == ("Jens", "Hansen")
