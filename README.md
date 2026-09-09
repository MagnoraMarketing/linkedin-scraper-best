# LinkedIn Lead Finder

A B2B lead-generation app for the Danish market. Search LinkedIn for decision
makers — CEO, CFO, Founder, Direktør, Ejer, Partner and so on — and collect the
results as deduplicated leads you can filter, edit, export to CSV and later push
to a dialer.

Built on [yagyeshVyas/linkedin-scraper](https://github.com/yagyeshVyas/linkedin-scraper):
the profile-extraction and search logic is derived from that project, reworked
into a web service.

---

## Contents

1. [Architecture](#1-architecture)
2. [Requirements](#2-requirements)
3. [Environment variables](#3-environment-variables)
4. [Supabase setup](#4-supabase-setup)
5. [Database migrations](#5-database-migrations)
6. [Local development](#6-local-development)
7. [Running the scraper worker](#7-running-the-scraper-worker)
8. [Deploying to Vercel](#8-deploying-to-vercel)
9. [Deploying the worker](#9-deploying-the-worker)
10. [Security](#10-security)
11. [Testing](#11-testing)
12. [Adding countries and cities](#12-adding-countries-and-cities)
13. [Connecting a dialer](#13-connecting-a-dialer)
14. [Enrichment](#14-enrichment)
15. [Troubleshooting](#15-troubleshooting)
16. [Legal and ethical use](#16-legal-and-ethical-use)

---

## 1. Architecture

```
Browser
   │
   ▼
Vercel — Next.js UI + API routes          (auth checked, Zod validated, rate limited)
   │
   │  INSERT scraping_jobs (status = queued)
   ▼
Supabase PostgreSQL                        (job queue + data + RLS)
   ▲                                        │
   │  upsert_lead / job_heartbeat           │  claim_next_job()  FOR UPDATE SKIP LOCKED
   │                                        ▼
Scraper worker — Docker container          (Python 3.11 + Playwright + Chromium)
   │
   ▼
LinkedIn
```

The frontend contains **no scraping logic at all**. The only contract between
the web app and the worker is a row in `scraping_jobs`, so the worker can be
moved to any host without touching the app.

### Why the scraper is not a Vercel Function

This was checked against Vercel's current limits before the architecture was
chosen. Three independent blockers, any one of which is fatal:

| Constraint | Reality | Effect |
|---|---|---|
| **Duration** | 300 s default on all plans; 800 s GA with Fluid compute on Pro/Enterprise; 1800 s in beta | A conservative 100-lead run takes 20–50 minutes at 8–18 s per profile. 500 leads takes hours. Even the beta ceiling is far too low. |
| **Bundle size** | Python functions inherit a 250 MB unzipped limit | Chromium alone is ~170 MB, plus system libraries (`libnss3`, `libatk`, `libgbm`, …) that are not in the runtime image. Playwright cannot download a browser to the read-only filesystem either. |
| **Statelessness** | Functions cannot hold a browser between invocations | There is no way to resume a half-finished scrape. |

Chopping the job into 300-second slices, or reaching for `@sparticuz/chromium`,
would be exactly the kind of fragile workaround worth avoiding. A long-lived
container is the correct shape for this workload. Everything else — the UI, the
API, auth — is an excellent fit for Vercel and lives there.

### Repository layout

```
app/                     Next.js App Router (pages + API routes)
components/              UI components, grouped by feature
lib/                     Supabase clients, validation, dedupe, CSV, integrations
types/                   Database schema types and API response types
middleware.ts            Route protection
worker/                  Python scraper worker (Docker)
supabase/migrations/     SQL migrations, applied in numeric order
supabase/tests/          SQL test suite for the schema
scripts/test-db.sh       Runs the migrations + SQL tests on a throwaway Postgres
__tests__/               Vitest suites
```

---

## 2. Requirements

| | Version | Needed for |
|---|---|---|
| Node.js | 20+ | The web app |
| Python | 3.11+ | The worker (only if running it outside Docker) |
| Docker | any recent | The recommended way to run the worker |
| PostgreSQL client | 14+ | Optional — only to run `scripts/test-db.sh` |
| A Supabase project | free tier is fine | Database + auth |
| A LinkedIn account | — | The scraper signs in with it. Use a dedicated account, not your main one. |

---

## 3. Environment variables

Copy `.env.example` and fill it in. The web app reads `.env.local`; the worker
reads `worker/.env`.

### Web app (set these on Vercel)

| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | `https://<ref>.supabase.co`. Safe in the browser. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Safe in the browser — RLS is what protects the data. |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | **Bypasses RLS.** Server-side only. Never add a `NEXT_PUBLIC_` prefix. |

The web app does **not** get `LINKEDIN_EMAIL` or `LINKEDIN_PASSWORD`. It has no
use for them, so it is never given them.

### Worker (set these on the worker host only)

| Variable | Default | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | — | Same project URL as above. |
| `SUPABASE_SERVICE_ROLE_KEY` | — | The worker writes on behalf of every user, so it needs this. |
| `LINKEDIN_EMAIL` | — | The scraper account. |
| `LINKEDIN_PASSWORD` | — | Read only by the worker process. |
| `SCRAPER_MAX_CONCURRENCY` | `1` | Profiles fetched at once. Values above 3 are refused. |
| `SCRAPER_DELAY_MS` | `8000` | Base delay between profile loads; randomised up to 2.25×. |
| `SCRAPER_TIMEOUT_MS` | `30000` | Per-navigation timeout. |
| `SCRAPER_MAX_RETRIES` | `3` | Retries per failed profile before it is skipped. |
| `SCRAPER_MAX_SEARCH_PAGES` | `10` | Search result pages loaded per job. |
| `SCRAPER_BREAK_EVERY_N_REQUESTS` | `15` | Pause after this many page loads. |
| `SCRAPER_POLL_INTERVAL_SECONDS` | `10` | Sleep between polls when the queue is empty. |
| `SCRAPER_HEADLESS` | `true` | Set `false` only to debug locally. |
| `SCRAPER_SESSION_DIR` | `.session` | Where the LinkedIn session is cached. Mount a volume here. |
| `SCRAPER_WORKER_ID` | `worker-1` | Identifies this instance in job claims and logs. |

The defaults are deliberately slow. Raising them raises the chance of tripping
LinkedIn's own protections, which this worker treats as a hard stop.

---

## 4. Supabase setup

1. Create a project at [supabase.com](https://supabase.com).
2. **Project Settings → Data API** — copy the Project URL.
3. **Project Settings → API Keys** — copy the `anon` key and the `service_role`
   key.
4. **Authentication → Providers** — make sure Email is enabled.
5. For a private tool, turn off public sign-ups once your account exists:
   **Authentication → Sign In / Providers → Allow new users to sign up**.

---

## 5. Database migrations

Run the four files in `supabase/migrations/` **in numeric order** in the
Supabase SQL editor (Database → SQL Editor → New query, paste, Run):

| File | Creates |
|---|---|
| `0001_init.sql` | Enums, the duplicate-detection key functions, `user_settings`, `scraping_jobs`, `leads`, `job_logs`, all indexes, and RLS policies on every table |
| `0002_user_bootstrap.sql` | A trigger that gives each new user a settings row |
| `0003_job_queue.sql` | `claim_next_job`, `job_heartbeat`, `finish_job`, `upsert_lead` |
| `0004_stats_and_rate_limit.sql` | `dashboard_stats`, the API rate-limit table and function |

Or paste all four at once. `scripts/build-setup-sql.sh` concatenates them into
a single `supabase-setup.sql` you can run in one go:

```bash
./scripts/build-setup-sql.sh
```

That file is generated rather than committed, so it cannot drift from the
migrations it is built from. Run it once — it is not idempotent, and a second
run will error on the `CREATE TYPE` and `CREATE TABLE` statements.

Or with the Supabase CLI:

```bash
supabase link --project-ref <your-ref>
supabase db push
```

### Verifying the schema locally

`scripts/test-db.sh` applies every migration to a throwaway PostgreSQL instance
and runs the SQL test suite — duplicate detection, the job queue, and RLS:

```bash
./scripts/test-db.sh
```

It needs a local PostgreSQL 14+ with `postgresql-contrib` (for `unaccent`).
Nothing touches your Supabase project.

---

## 6. Local development

```bash
git clone https://github.com/MagnoraMarketing/linkedin-scraper-best.git
cd linkedin-scraper-best

npm install
cp .env.example .env.local     # fill in the three Supabase values
npm run dev
```

Open <http://localhost:3000>. You will be redirected to `/login`; create an
account with the sign-up link, then you land on `/search`.

If the Supabase variables are missing, every route redirects to `/setup`, which
tells you exactly what is missing rather than throwing.

Useful scripts:

```bash
npm run dev         # dev server
npm run build       # production build
npm run lint        # ESLint, zero warnings allowed
npm run typecheck   # tsc --noEmit
npm run test        # Vitest
npm run format      # Prettier
```

---

## 7. Running the scraper worker

### With Docker (recommended)

```bash
cd worker
cp ../.env.example .env        # fill in Supabase + LinkedIn values
docker compose up --build
```

### Without Docker

```bash
cd worker
python -m venv .venv
source .venv/bin/activate            # Windows: .venv\Scripts\activate
pip install -r requirements.txt
playwright install --with-deps chromium

export $(grep -v '^#' .env | xargs)  # or set the variables however you prefer
python -m linkedin_lead_worker.main
```

The worker polls for queued jobs, claims one at a time, and logs one JSON
object per line to stdout.

### First run

On its first run the worker signs in with `LINKEDIN_EMAIL` / `LINKEDIN_PASSWORD`
and caches the session in `SCRAPER_SESSION_DIR`. Later runs reuse it, which is
both faster and much less likely to trigger a verification challenge — which is
why that directory should be a mounted volume in production.

If LinkedIn asks for 2FA or a security checkpoint, the worker **stops and
reports it**. It does not attempt to solve, bypass or wait out the challenge.
Sign in to the account in a normal browser, complete the challenge, then restart
the worker.

---

## 8. Deploying to Vercel

1. Push this repository to GitHub.
2. In Vercel: **Add New → Project**, import the repository. The framework is
   detected automatically; leave the root directory as the repository root
   (`.vercelignore` keeps `worker/` out of the build).
3. **Settings → Environment Variables** — add all three Supabase variables for
   Production, Preview and Development.
4. Deploy.

`vercel.json` caps the API functions at 30 seconds, which is generous: the
slowest of them only writes a queue row.

Do **not** set `LINKEDIN_EMAIL` or `LINKEDIN_PASSWORD` on Vercel. Nothing there
reads them.

---

## 9. Deploying the worker

The worker needs a host that runs long-lived containers. The `Dockerfile` is
portable; `fly.toml` is included as a worked example.

### Fly.io

```bash
cd worker
fly launch --no-deploy --copy-config
fly volumes create worker_session --size 1
fly secrets set \
  NEXT_PUBLIC_SUPABASE_URL="https://<ref>.supabase.co" \
  SUPABASE_SERVICE_ROLE_KEY="..." \
  LINKEDIN_EMAIL="..." \
  LINKEDIN_PASSWORD="..."
fly deploy
```

### Anything else

Railway, Render, a VPS with `docker compose`, or your own Kubernetes — the
image is standard. Two requirements:

- **A persistent volume at `SCRAPER_SESSION_DIR`.** Without it every restart
  forces a fresh LinkedIn sign-in.
- **Do not scale to zero.** A worker killed mid-job leaves it running until the
  heartbeat goes stale (5 minutes), after which it is re-claimed. That is safe,
  but it wastes time.

Running two workers is supported — `claim_next_job` uses `FOR UPDATE SKIP
LOCKED`, so they never collide — but each one signs in as the same LinkedIn
account, which increases rate-limit pressure. One worker is the sensible
default.

---

## 10. Security

**Credentials.** LinkedIn credentials live only in the worker's environment.
They are never stored in the database, sent to the browser, returned by an API,
or written to a log. There is deliberately no UI field for them. The worker's
logger passes every record through a redaction filter, so a secret that ends up
in a message or an exception string is replaced before any handler sees it.

**Service role key.** `lib/supabase/admin.ts` imports `server-only`, which makes
importing it from a Client Component a build error. The key therefore cannot
reach the browser bundle.

**Row Level Security.** Enabled on every table, deny by default, with policies
comparing `auth.uid()` to `user_id`. This is verified by
`supabase/tests/schema_test.sql`, which checks that a user sees only their own
rows, that cross-user updates and deletes affect zero rows, that a cross-user
insert is rejected, that the `anon` role cannot read `leads` at all, and that
the worker's RPCs are not callable from a browser session.

**Defence in depth.** Every API route independently authenticates the caller
with `getUser()` (which validates the JWT with Supabase, unlike `getSession()`)
and filters every query on `user_id`. RLS is the backstop, not the only line.

**Input validation.** Every request body and query string is parsed with Zod
before it reaches the database. Search terms are stripped of PostgREST's `or`
separators so a filter cannot be rewritten from a search box.

**Rate limiting.** Enforced in PostgreSQL, because Vercel functions are
stateless and an in-process counter would reset on every cold start. Search
creation is limited to 10 per hour per user.

**Error messages.** Users get a stable code and a readable message. Database
errors, connection strings and constraint names go to the server log only.

**CSV injection.** Exported fields starting with `=`, `+`, `-` or `@` are
prefixed with an apostrophe, so a scraped value cannot execute as a formula
when the file is opened in Excel.

---

## 11. Testing

```bash
npm run test              # Vitest: dedupe, CSV, validation, API auth/authz
./scripts/test-db.sh      # SQL: schema, duplicate detection, job queue, RLS
cd worker && pytest       # Python: parsing, config, redaction, geo, job runner
```

What is covered:

| Area | Where |
|---|---|
| Duplicate detection, all three keys | `__tests__/dedupe.test.ts`, `supabase/tests/schema_test.sql` |
| Lead validation | `__tests__/validation.test.ts` |
| Job creation, limits, concurrency | `__tests__/api.test.ts` |
| Authentication on every endpoint | `__tests__/api.test.ts` |
| Authorization / user scoping | `__tests__/api.test.ts`, `supabase/tests/schema_test.sql` |
| CSV export, including injection | `__tests__/csv.test.ts` |
| Scraper HTML parsing | `worker/tests/test_parsing.py` |
| Job queue and restart safety | `supabase/tests/schema_test.sql`, `worker/tests/test_runner.py` |
| Secret redaction in logs | `worker/tests/test_config_and_logging.py` |

The TypeScript and SQL duplicate-detection rules are implemented separately and
tested against the same cases, so a drift between them fails a test rather than
silently creating duplicates.

---

## 12. Adding countries and cities

LinkedIn filters people search on numeric location ids (`geoUrn`). Only ids
verified against a real LinkedIn URL are configured. Denmark is
`104514075`; a few others are present but disabled.

**The Danish city ids are not verified and are set to `null` on purpose.** A
wrong id would silently search the wrong place, which is worse than not
filtering server-side. For a city without an id the worker still narrows to the
country and then matches the location text on each profile.

To add a verified id:

1. Run the search on LinkedIn with the location filter applied.
2. Read it out of the address bar: `...&geoUrn=%5B"104514075"%5D` → `104514075`.
3. Add it in **both** places:
   - `lib/constants/search.ts` — for the dropdown (set `enabled: true` for a country)
   - `worker/linkedin_lead_worker/geo.py` — for the scraper

For a new city, add the location text variants to `CITY_TEXT_MATCHES` too, so
the text fallback works before an id is found (for example Copenhagen matches
`copenhagen`, `københavn`, `kobenhavn` and `kbh`).

---

## 13. Connecting a dialer

`POST /api/leads/export-to-dialer` is implemented and authenticated, but no
dialer ships with the app — inventing an API for a system that already exists
would only produce code to throw away. Until one is connected the endpoint
returns `501 dialer_not_configured` rather than pretending to succeed.

To connect yours, implement `DialerProvider` (`lib/integrations/dialer/types.ts`):

```ts
import { setDialerProvider, leadToDialerContact } from '@/lib/integrations/dialer';

class MyDialerProvider implements DialerProvider {
  readonly id = 'my-dialer';
  readonly name = 'My Dialer';

  isConfigured() {
    return Boolean(process.env.MY_DIALER_API_KEY);
  }

  async exportLeads(leads) {
    const contacts = leads.map(leadToDialerContact);
    // ...push to your system, then report per-lead outcomes
    return { provider: this.id, exported: contacts.length, failed: 0, results: [] };
  }
}

setDialerProvider(new MyDialerProvider());
```

Nothing else changes.

---

## 14. Enrichment

`email`, `phone` and `mobile_phone` are `null` unless LinkedIn actually
published them. **The scraper never invents contact data** — it does not build
an address from a name and a domain, and it does not generate phone numbers. A
phone number is read only from an explicit `tel:` link, and email addresses are
filtered against a list of asset and vendor domains that produce email-shaped
false positives.

To fill those gaps, implement `EnrichmentProvider`
(`lib/integrations/enrichment/index.ts`) against a real data vendor and register
it with `setEnrichmentProvider()`. The default provider resolves nothing and
reports that honestly.

---

## 15. Troubleshooting

**Every page redirects to `/setup`.** The Supabase environment variables are
missing. Add them and redeploy.

**A job sits at "Queued" forever.** No worker is running, or it cannot reach
Supabase. Check the worker logs. Verify `NEXT_PUBLIC_SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` are set on the worker, and that the migrations —
especially `0003_job_queue.sql`, which creates `claim_next_job` — have been run.

**"LinkedIn requires a verification step."** LinkedIn served a 2FA prompt,
security checkpoint or CAPTCHA. This is not worked around by design. Sign in to
the scraper account in a normal browser, complete the challenge, delete the
cached session directory, and restart the worker.

**"LinkedIn rejected the scraper account's credentials."** Check
`LINKEDIN_EMAIL` and `LINKEDIN_PASSWORD` on the worker. The worker does not
retry past a rejection — repeated attempts are what get an account locked.

**"LinkedIn served a sign-in wall."** The cached session expired. Delete the
session directory and restart; the worker will sign in fresh.

**A search finds fewer leads than requested.** Expected. LinkedIn's keyword
search is fuzzy, so results are filtered a second time on job title and
location, and anything already in your database is skipped as a duplicate. The
job log on `/jobs/[id]` shows exactly what happened.

**Jobs are slow.** By design — see the delay settings. 100 leads takes roughly
20–50 minutes. Lowering `SCRAPER_DELAY_MS` is not recommended.

**"You already have a search in progress."** One search runs at a time. Cancel
it on `/search` or wait for it to finish.

**Duplicates appear in the database.** They should not — three unique indexes
prevent it. Check that `0001_init.sql` applied cleanly, in particular the
`unaccent` extension and the `lead_*_key` functions.

**`unaccent` errors when applying migrations.** Enable the extension:
`create extension if not exists unaccent;`. On a self-hosted Postgres install
`postgresql-contrib` first.

---

## 16. Legal and ethical use

The upstream project this is derived from states it is for educational purposes
and not for commercial use, and LinkedIn's
[User Agreement](https://www.linkedin.com/legal/user-agreement) prohibits
scraping. Using this tool commercially is your decision and your risk. Consider
your GDPR obligations too: leads are personal data, and you need a lawful basis
for processing them, plus a way to honour deletion requests. The `do_not_contact`
status and the delete action exist for that.

What this application deliberately does **not** do, and will not be extended to
do:

- Solve, bypass or wait out CAPTCHAs, 2FA or security checkpoints
- Spoof browser fingerprints or use stealth automation-hiding scripts
- Rotate proxies or user agents to evade rate limits
- Exceed LinkedIn's rate limits through aggressive parallelism

When LinkedIn refuses a request or asks for human verification, the job stops
and tells you why. The conservative defaults are the point, not an obstacle.

---

## License

MIT — see [LICENSE](LICENSE).
