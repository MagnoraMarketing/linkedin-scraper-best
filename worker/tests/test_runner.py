"""Job lifecycle tests.

The Supabase client and the scraper are both replaced with fakes, so these
exercise the runner's own decisions: what counts as a duplicate, when a job is
completed rather than failed, how cancellation is honoured, and that a lead
that fails to save never takes the whole job down.
"""

from typing import Any

import pytest

from linkedin_lead_worker.config import Config
from linkedin_lead_worker.models import JobErrorCode, ScrapedLead, ScraperStop
from linkedin_lead_worker.runner import JobRunner
from linkedin_lead_worker.supabase_client import SupabaseError


class FakeSupabase:
    """Records every call so tests can assert on the resulting job state."""

    def __init__(self, upsert_actions: list[str] | None = None) -> None:
        self.upsert_actions = upsert_actions or []
        self._upsert_index = 0
        self.heartbeats: list[dict[str, Any]] = []
        self.finished: dict[str, Any] | None = None
        self.logs: list[dict[str, Any]] = []
        self.cancel_after: int | None = None
        self.upsert_raises_on: set[int] = set()
        self.upserted: list[dict[str, Any]] = []

    async def existing_linkedin_urls(self, user_id: str) -> set[str]:
        return set()

    async def upsert_lead(self, args: dict[str, Any]) -> tuple[str, str]:
        index = self._upsert_index
        self._upsert_index += 1

        if index in self.upsert_raises_on:
            raise SupabaseError("simulated write failure")

        self.upserted.append(args)
        action = (
            self.upsert_actions[index]
            if index < len(self.upsert_actions)
            else "inserted"
        )
        return f"lead-{index}", action

    async def heartbeat(self, job_id, worker_id, found=None, duplicates=None, processed=None):
        self.heartbeats.append(
            {"found": found, "duplicates": duplicates, "processed": processed}
        )
        if self.cancel_after is not None and len(self.heartbeats) >= self.cancel_after:
            return True
        return False

    async def finish_job(self, job_id, worker_id, status, error_message=None, error_code=None):
        self.finished = {
            "status": status,
            "error_message": error_message,
            "error_code": error_code,
        }

    async def log(self, job_id, user_id, event, message=None, level="info"):
        self.logs.append({"event": event, "message": message, "level": level})


class FakeScraper:
    """Stands in for LinkedInScraper: yields prepared leads, or raises."""

    def __init__(self, leads: list[ScrapedLead], raises: Exception | None = None) -> None:
        self._leads = leads
        self._raises = raises
        self.logged_in = False

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return None

    async def login(self):
        self.logged_in = True

    async def run_search(self, params, on_lead, skip_urls=None, on_log=None):
        if self._raises is not None:
            raise self._raises
        for lead in self._leads:
            if not await on_lead(lead):
                return


@pytest.fixture
def config(monkeypatch):
    monkeypatch.setenv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "key")
    monkeypatch.setenv("LINKEDIN_EMAIL", "a@b.dk")
    monkeypatch.setenv("LINKEDIN_PASSWORD", "password-value")
    return Config()


JOB = {
    "id": "job-1",
    "user_id": "user-1",
    "job_titles": ["CFO"],
    "country": "DK",
    "location": "all",
    "company_size": "any",
    "industry": "all",
    "requested_count": 5,
}


def install_scraper(monkeypatch, scraper: FakeScraper) -> None:
    monkeypatch.setattr(
        "linkedin_lead_worker.runner.LinkedInScraper", lambda _config: scraper
    )


def lead(name: str) -> ScrapedLead:
    return ScrapedLead(full_name=name, linkedin_url=f"https://linkedin.com/in/{name.lower()}")


# ---------------------------------------------------------------------------


async def test_completed_job_counts_inserts_and_duplicates(config, monkeypatch):
    supabase = FakeSupabase(upsert_actions=["inserted", "updated", "inserted"])
    install_scraper(monkeypatch, FakeScraper([lead("A"), lead("B"), lead("C")]))

    await JobRunner(config, supabase).run(JOB)

    assert supabase.finished == {
        "status": "completed",
        "error_message": None,
        "error_code": None,
    }
    final = supabase.heartbeats[-1]
    # Two new leads, one merged into an existing row, three profiles processed.
    assert final["found"] == 2
    assert final["duplicates"] == 1
    assert final["processed"] == 3


async def test_job_stops_once_the_requested_count_is_reached(config, monkeypatch):
    small_job = {**JOB, "requested_count": 2}
    supabase = FakeSupabase(upsert_actions=["inserted"] * 5)
    install_scraper(monkeypatch, FakeScraper([lead(n) for n in "ABCDE"]))

    await JobRunner(config, supabase).run(small_job)

    assert supabase.finished is not None
    assert supabase.finished["status"] == "completed"
    assert len(supabase.upserted) == 2


async def test_cancellation_is_honoured_and_keeps_saved_leads(config, monkeypatch):
    supabase = FakeSupabase(upsert_actions=["inserted"] * 5)
    supabase.cancel_after = 1  # the first heartbeat reports a cancellation
    install_scraper(monkeypatch, FakeScraper([lead(n) for n in "ABCDE"]))

    await JobRunner(config, supabase).run(JOB)

    assert supabase.finished is not None
    assert supabase.finished["status"] == "cancelled"
    # Whatever was already written stays written.
    assert len(supabase.upserted) >= 1
    assert any(entry["event"] == "job_cancelled" for entry in supabase.logs)


async def test_login_failure_fails_the_job_with_a_specific_code(config, monkeypatch):
    supabase = FakeSupabase()
    install_scraper(
        monkeypatch,
        FakeScraper([], raises=ScraperStop(JobErrorCode.LOGIN_FAILED, "Credentials rejected.")),
    )

    await JobRunner(config, supabase).run(JOB)

    assert supabase.finished is not None
    assert supabase.finished["status"] == "failed"
    assert supabase.finished["error_code"] == "login_failed"
    assert supabase.finished["error_message"] == "Credentials rejected."


async def test_verification_challenge_is_reported_not_worked_around(config, monkeypatch):
    supabase = FakeSupabase()
    install_scraper(
        monkeypatch,
        FakeScraper(
            [],
            raises=ScraperStop(
                JobErrorCode.REQUIRES_VERIFICATION,
                "LinkedIn requires a verification step.",
            ),
        ),
    )

    await JobRunner(config, supabase).run(JOB)

    assert supabase.finished is not None
    assert supabase.finished["error_code"] == "requires_verification"


async def test_no_results_with_nothing_saved_is_a_failure(config, monkeypatch):
    supabase = FakeSupabase()
    install_scraper(
        monkeypatch,
        FakeScraper([], raises=ScraperStop(JobErrorCode.NO_RESULTS, "Nothing matched.")),
    )

    await JobRunner(config, supabase).run(JOB)

    assert supabase.finished is not None
    assert supabase.finished["status"] == "failed"
    assert supabase.finished["error_code"] == "no_results"


async def test_running_out_of_results_after_saving_some_is_a_completed_job(config, monkeypatch):
    """Exhausting LinkedIn's results is not a failure if leads were found."""

    class PartialScraper(FakeScraper):
        async def run_search(self, params, on_lead, skip_urls=None, on_log=None):
            await on_lead(lead("A"))
            await on_lead(lead("B"))
            raise ScraperStop(JobErrorCode.NO_RESULTS, "No more profiles.")

    supabase = FakeSupabase(upsert_actions=["inserted", "inserted"])
    install_scraper(monkeypatch, PartialScraper([]))

    await JobRunner(config, supabase).run(JOB)

    assert supabase.finished is not None
    assert supabase.finished["status"] == "completed"


async def test_one_failed_lead_write_does_not_fail_the_job(config, monkeypatch):
    supabase = FakeSupabase(upsert_actions=["inserted", "inserted", "inserted"])
    supabase.upsert_raises_on = {1}  # the second lead fails to save
    install_scraper(monkeypatch, FakeScraper([lead("A"), lead("B"), lead("C")]))

    await JobRunner(config, supabase).run(JOB)

    assert supabase.finished is not None
    assert supabase.finished["status"] == "completed"
    assert any(entry["event"] == "lead_save_failed" for entry in supabase.logs)


async def test_unexpected_error_fails_the_job_without_leaking_detail(config, monkeypatch):
    supabase = FakeSupabase()
    install_scraper(monkeypatch, FakeScraper([], raises=RuntimeError("connection string: postgres://u:p@h/db")))

    await JobRunner(config, supabase).run(JOB)

    assert supabase.finished is not None
    assert supabase.finished["status"] == "failed"
    assert supabase.finished["error_code"] == "worker_error"
    # The internal detail must not reach the user-facing message or the job log.
    assert "postgres://" not in (supabase.finished["error_message"] or "")
    for entry in supabase.logs:
        assert "postgres://" not in (entry["message"] or "")


async def test_the_job_log_records_the_run(config, monkeypatch):
    supabase = FakeSupabase(upsert_actions=["inserted"])
    install_scraper(monkeypatch, FakeScraper([lead("A")]))

    await JobRunner(config, supabase).run(JOB)

    events = [entry["event"] for entry in supabase.logs]
    assert "job_started" in events
    assert "job_completed" in events
