-- ============================================================================
--  LinkedIn Lead Finder — initial schema
--
--  Creates: user_settings, scraping_jobs, leads, job_logs
--  Enables Row Level Security on all of them so a user can only ever reach
--  their own rows. The scraper worker connects with the service role key and
--  filters on user_id explicitly (see 0003_job_queue.sql).
-- ============================================================================

create extension if not exists "uuid-ossp";
create extension if not exists "unaccent";

-- ---------------------------------------------------------------------------
--  Enums
-- ---------------------------------------------------------------------------

create type job_status as enum (
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled'
);

create type lead_status as enum (
  'new',
  'qualified',
  'contacted',
  'interested',
  'meeting',
  'not_interested',
  'invalid',
  'do_not_contact'
);

create type log_level as enum ('info', 'warn', 'error');

-- ---------------------------------------------------------------------------
--  updated_at trigger
-- ---------------------------------------------------------------------------

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
--  user_settings — per-user defaults shown on /settings
--
--  Deliberately holds NO secrets. The LinkedIn password lives only in the
--  worker's environment; linkedin_account_email is stored purely so the UI can
--  display which account the worker is configured to use.
-- ---------------------------------------------------------------------------

create table user_settings (
  user_id                uuid primary key references auth.users (id) on delete cascade,
  default_country        text        not null default 'DK',
  default_job_titles     text[]      not null default array['CEO', 'CFO', 'Founder']::text[],
  default_location       text        not null default 'all',
  default_lead_limit     integer     not null default 25,
  max_lead_limit         integer     not null default 500,
  linkedin_account_email text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint user_settings_default_lead_limit_positive
    check (default_lead_limit > 0),
  constraint user_settings_max_lead_limit_range
    check (max_lead_limit > 0 and max_lead_limit <= 2000),
  constraint user_settings_default_within_max
    check (default_lead_limit <= max_lead_limit)
);

create trigger user_settings_set_updated_at
  before update on user_settings
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
--  scraping_jobs — the queue. A row here is the entire contract between the
--  Vercel API and the worker service.
-- ---------------------------------------------------------------------------

create table scraping_jobs (
  id               uuid        primary key default uuid_generate_v4(),
  user_id          uuid        not null references auth.users (id) on delete cascade,
  status           job_status  not null default 'queued',

  -- search parameters
  job_titles       text[]      not null,
  country          text        not null,
  location         text,
  company_size     text,
  industry         text,
  requested_count  integer     not null,

  -- progress
  found_count      integer     not null default 0,
  duplicate_count  integer     not null default 0,
  processed_count  integer     not null default 0,

  -- lifecycle
  cancel_requested boolean     not null default false,
  error_message    text,
  error_code       text,
  started_at       timestamptz,
  completed_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint scraping_jobs_requested_count_range
    check (requested_count > 0 and requested_count <= 2000),
  constraint scraping_jobs_job_titles_not_empty
    check (array_length(job_titles, 1) >= 1)
);

create trigger scraping_jobs_set_updated_at
  before update on scraping_jobs
  for each row execute function set_updated_at();

create index scraping_jobs_user_created_idx
  on scraping_jobs (user_id, created_at desc);

create index scraping_jobs_status_idx
  on scraping_jobs (status, created_at)
  where status in ('queued', 'running');

-- ---------------------------------------------------------------------------
--  Duplicate-detection key functions
--
--  Used both by the generated columns on `leads` and by upsert_lead(), so the
--  lookup and the constraint can never disagree. Mirrored exactly in
--  lib/leads/dedupe.ts, and the TypeScript test suite covers the same cases.
--
--  All three must be IMMUTABLE to be usable in a generated column. unaccent()
--  is only STABLE, because it resolves a dictionary by name at call time;
--  immutable_unaccent() pins the dictionary so the result is reproducible.
-- ---------------------------------------------------------------------------

create or replace function immutable_unaccent(text)
returns text
language sql
immutable
strict
parallel safe
as $$
  select public.unaccent('public.unaccent'::regdictionary, $1)
$$;

-- Strips protocol, subdomain, host, query, fragment and trailing slashes, so
-- every spelling of one profile collapses to a single key:
--   https://www.linkedin.com/in/Jens-Hansen-123/?utm=x -> /in/jens-hansen-123
create or replace function lead_linkedin_url_key(p_url text)
returns text
language sql
immutable
parallel safe
as $$
  -- Three passes, in this order: the trailing slash is only exposed once the
  -- query string is gone, so one combined pattern would leave it behind.
  select nullif(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          lower(btrim(coalesce(p_url, ''))),
          '^https?://([a-z0-9-]+\.)?linkedin\.com', ''
        ),
        '[?#].*$', ''
      ),
      '/+$', ''
    ),
    ''
  )
$$;

create or replace function lead_email_key(p_email text)
returns text
language sql
immutable
parallel safe
as $$
  select nullif(lower(btrim(coalesce(p_email, ''))), '')
$$;

-- Folds one side of the name+company key: lowercased, accents and Nordic
-- letters reduced to ASCII, punctuation removed (not replaced with a space, so
-- "A/S Bak & Co." and "AS Bak Co" agree), whitespace collapsed and trimmed.
create or replace function lead_fold_text(p_value text)
returns text
language sql
immutable
parallel safe
as $$
  select btrim(
    regexp_replace(
      regexp_replace(
        lower(immutable_unaccent(coalesce(p_value, ''))),
        '[^a-z0-9[:space:]]+', '', 'g'
      ),
      '[[:space:]]+', ' ', 'g'
    )
  )
$$;

-- The two sides are folded separately and joined with a pipe, so a name and a
-- company cannot be swapped and still collide.
create or replace function lead_name_company_key(p_full_name text, p_company_name text)
returns text
language sql
immutable
parallel safe
as $$
  select nullif(
    lead_fold_text(p_full_name) || '|' || lead_fold_text(p_company_name),
    '|'
  )
$$;

-- ---------------------------------------------------------------------------
--  leads
--
--  Duplicate detection is enforced by the database, not by application code,
--  so a worker that crashes and restarts mid-job can never create duplicates.
--  Three generated keys, in the priority order from the spec:
--    1. linkedin_url  2. email  3. name + company
-- ---------------------------------------------------------------------------

create table leads (
  id                   uuid        primary key default uuid_generate_v4(),
  user_id              uuid        not null references auth.users (id) on delete cascade,

  full_name            text        not null,
  first_name           text,
  last_name            text,
  job_title            text,
  company_name         text,
  company_website      text,
  company_linkedin_url text,
  linkedin_url         text,
  location             text,
  country              text,
  industry             text,
  company_size         text,

  -- Enrichment targets. NULL until a real provider fills them in; the scraper
  -- never invents an address or a number.
  email                text,
  phone                text,
  mobile_phone         text,

  source               text        not null default 'linkedin',
  source_url           text,
  status               lead_status not null default 'new',
  notes                text,

  job_id               uuid        references scraping_jobs (id) on delete set null,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  -- ---- duplicate detection keys (generated, never written by hand) ----
  --  1. LinkedIn URL   2. Email   3. Name + company
  linkedin_url_key text generated always as (lead_linkedin_url_key(linkedin_url)) stored,
  email_key        text generated always as (lead_email_key(email)) stored,
  name_company_key text generated always as (
    lead_name_company_key(full_name, company_name)
  ) stored,

  constraint leads_full_name_not_blank check (length(trim(full_name)) > 0)
);

create trigger leads_set_updated_at
  before update on leads
  for each row execute function set_updated_at();

-- Duplicate-detection indexes, scoped per user: two users may each hold the
-- same lead, but one user never holds it twice.
create unique index leads_user_linkedin_url_key_uniq
  on leads (user_id, linkedin_url_key)
  where linkedin_url_key is not null;

create unique index leads_user_email_key_uniq
  on leads (user_id, email_key)
  where email_key is not null;

create unique index leads_user_name_company_key_uniq
  on leads (user_id, name_company_key)
  where name_company_key is not null;

-- Query indexes for the /leads table
create index leads_user_created_idx  on leads (user_id, created_at desc);
create index leads_user_status_idx   on leads (user_id, status);
create index leads_user_company_idx  on leads (user_id, company_name);
create index leads_job_idx           on leads (job_id);

-- Free-text search across the columns the UI searches on
create index leads_search_idx on leads using gin (
  to_tsvector(
    'simple',
    coalesce(full_name, '') || ' ' ||
    coalesce(company_name, '') || ' ' ||
    coalesce(job_title, '') || ' ' ||
    coalesce(email, '')
  )
);

-- ---------------------------------------------------------------------------
--  job_logs — the structured run log surfaced on /jobs/[id]
--
--  The worker is responsible for never writing a credential, cookie or key
--  into `message`; see worker/linkedin_lead_worker/logging_setup.py, which
--  redacts known secret values before anything is emitted.
-- ---------------------------------------------------------------------------

create table job_logs (
  id         bigserial   primary key,
  job_id     uuid        not null references scraping_jobs (id) on delete cascade,
  user_id    uuid        not null references auth.users (id) on delete cascade,
  level      log_level   not null default 'info',
  event      text        not null,
  message    text,
  created_at timestamptz not null default now()
);

create index job_logs_job_created_idx on job_logs (job_id, created_at);

-- ============================================================================
--  ROW LEVEL SECURITY
--
--  Every table is deny-by-default. Each policy compares auth.uid() to user_id,
--  so an authenticated request can only ever touch its own rows — even if an
--  API route forgot a filter. The service role bypasses RLS by design and is
--  only ever used server-side.
-- ============================================================================

alter table user_settings  enable row level security;
alter table scraping_jobs  enable row level security;
alter table leads          enable row level security;
alter table job_logs       enable row level security;

-- user_settings
create policy user_settings_select on user_settings
  for select to authenticated using (auth.uid() = user_id);
create policy user_settings_insert on user_settings
  for insert to authenticated with check (auth.uid() = user_id);
create policy user_settings_update on user_settings
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy user_settings_delete on user_settings
  for delete to authenticated using (auth.uid() = user_id);

-- scraping_jobs
create policy scraping_jobs_select on scraping_jobs
  for select to authenticated using (auth.uid() = user_id);
create policy scraping_jobs_insert on scraping_jobs
  for insert to authenticated with check (auth.uid() = user_id);
create policy scraping_jobs_update on scraping_jobs
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy scraping_jobs_delete on scraping_jobs
  for delete to authenticated using (auth.uid() = user_id);

-- leads
create policy leads_select on leads
  for select to authenticated using (auth.uid() = user_id);
create policy leads_insert on leads
  for insert to authenticated with check (auth.uid() = user_id);
create policy leads_update on leads
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy leads_delete on leads
  for delete to authenticated using (auth.uid() = user_id);

-- job_logs — read-only for users; only the worker (service role) writes.
create policy job_logs_select on job_logs
  for select to authenticated using (auth.uid() = user_id);
