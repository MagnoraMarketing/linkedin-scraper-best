# Project decisions

Operational decisions for this deployment. They were settled in conversation
and kept being re-derived wrongly from the README, which cost real time — so
they live here, in the repository, where they survive.

Read this before recommending a host, an integration, or a Supabase project.

---

## Supabase project

**`mjncziwoqpqhljcoevoe`** (region `eu-west-2`, West Europe / London).

- Project URL: `https://mjncziwoqpqhljcoevoe.supabase.co`
- The ref is baked into every API key issued by the project: the middle segment
  of the anon JWT decodes to `{"iss":"supabase","ref":"mjncziwoqpqhljcoevoe"}`.
  Use that to confirm a key belongs to this project before pasting it anywhere.

An earlier project ref appeared in tooling and was wrong. If a Supabase tool
reports a different ref, or its database calls fail with
`28P01: password authentication failed`, the tool is pointed at a stale
project — trust this file, not the tool.

**Schema status:** all four migrations in `supabase/migrations/` are applied —
five tables (`user_settings`, `scraping_jobs`, `leads`, `job_logs`,
`api_rate_limits`) and six functions (`claim_next_job`, `job_heartbeat`,
`finish_job`, `upsert_lead`, `dashboard_stats`, `check_rate_limit`), all
verified present. Do not re-run the migrations; they are not idempotent and
will fail on `type "job_status" already exists`.

They were applied through the SQL editor, so
`supabase_migrations.schema_migrations` does not record them. That is what
`supabase/repair-migration-ledger.sql` is for.

---

## The worker runs on a Windows PC

**Not Render. Not Fly.io. Not Docker. Not Vercel.**

`worker/start-worker.bat`, double-clicked, is the deployment. This is a
deliberate choice, not a fallback:

- The only contract between the web app and the worker is a row in
  `scraping_jobs`, so the worker needs outbound internet access and nothing
  more. Nothing has to reach it from outside.
- It costs nothing. Render has no free tier for background workers, and
  Chromium needs the paid `standard` plan to avoid the OOM reaper.
- The session cache in `worker/.session` persists on local disk with no volume
  to configure, and a LinkedIn verification challenge can be solved by hand by
  setting `SCRAPER_HEADLESS=false` for one run — awkward on a remote host.

`render.yaml` and `fly.toml` remain in the repository as worked examples for a
future unattended deployment. **They are not in use.** Do not propose Render.

**Python 3.10–3.13 only.** Not 3.14: the pinned `pydantic-core` and `greenlet`
ship wheels through cp313 only.

---

## Not in scope

- **No dialer.** `lib/integrations/dialer/` stays the `NotConfiguredDialerProvider`
  stub. CSV export is how leads leave the system. Do not list "connect a
  dialer" as outstanding work.
- **No enrichment.** `lib/integrations/enrichment/` stays the noop provider.

Both are deliberate stubs that report honestly rather than pretending to
succeed. README §13 and §14 describe how they *could* be wired up; nobody is
asking for it.

---

## Where configuration lives

Two places, and only two:

| Where | What |
|---|---|
| Vercel → project `linkedin-scraper-best` → Environment Variables | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| `worker/.env` on the operator's PC | `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `LINKEDIN_EMAIL`, `LINKEDIN_PASSWORD` |

LinkedIn credentials never go on Vercel — nothing there reads them.

`NEXT_PUBLIC_*` values are inlined into the browser bundle **at build time**, so
changing them in Vercel requires a redeploy. Editing the variable alone leaves
the running app on the old value, which looks exactly like the edit not working.

### The stray Vercel `worker` project

Vercel treats this repository as a monorepo and auto-creates a project rooted
at `worker/`. It cannot build — that directory is Python and Chromium — so
`worker/vercel.json` sets `ignoreCommand` to `exit 0` to keep it from failing
every commit. **Delete such a project; never put credentials in it.** It has
reappeared after deletion before.

---

## Verifying a change

```bash
npm run lint && npx vitest run          # 89 tests
cd worker && python -m pytest -q        # 57 tests
```

CI runs both on every push.
