-- ============================================================================
--  Job queue + duplicate-safe lead upsert
--
--  These functions are the worker's entire write surface. They run as
--  SECURITY DEFINER so the worker never needs ad-hoc table access, and every
--  one of them is restartable: claiming, heartbeating and lead insertion are
--  all idempotent, so a worker that dies mid-job and comes back cannot
--  duplicate work or data.
-- ============================================================================

-- Queue bookkeeping columns live here rather than in 0001 so the queue
-- mechanics stay in one file with the functions that use them.
alter table scraping_jobs
  add column worker_id    text,
  add column claimed_at   timestamptz,
  add column heartbeat_at timestamptz;

create index scraping_jobs_heartbeat_idx
  on scraping_jobs (heartbeat_at)
  where status = 'running';

-- ---------------------------------------------------------------------------
--  claim_next_job — atomically take the oldest queued job.
--
--  FOR UPDATE SKIP LOCKED means several workers can poll the same queue
--  without ever handing the same job to two of them. A 'running' job whose
--  worker stopped heartbeating for longer than p_stale_after is treated as
--  abandoned and re-claimed.
-- ---------------------------------------------------------------------------

create or replace function claim_next_job(
  p_worker_id   text,
  p_stale_after interval default interval '5 minutes'
)
returns setof scraping_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_id uuid;
begin
  select id into v_job_id
  from scraping_jobs
  where status = 'queued'
     or (status = 'running'
         and heartbeat_at is not null
         and heartbeat_at < now() - p_stale_after)
  order by created_at
  for update skip locked
  limit 1;

  if v_job_id is null then
    return;
  end if;

  return query
  update scraping_jobs
  set status       = 'running',
      worker_id    = p_worker_id,
      claimed_at   = now(),
      heartbeat_at = now(),
      started_at   = coalesce(started_at, now()),
      error_message = null,
      error_code    = null
  where id = v_job_id
  returning *;
end;
$$;

-- ---------------------------------------------------------------------------
--  job_heartbeat — keep the claim alive and publish progress.
--
--  Returns the job's cancel_requested flag so the worker learns about a
--  cancellation on its next progress tick without a second round trip.
-- ---------------------------------------------------------------------------

create or replace function job_heartbeat(
  p_job_id          uuid,
  p_worker_id       text,
  p_found_count     integer default null,
  p_duplicate_count integer default null,
  p_processed_count integer default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cancel boolean;
begin
  update scraping_jobs
  set heartbeat_at    = now(),
      found_count     = coalesce(p_found_count, found_count),
      duplicate_count = coalesce(p_duplicate_count, duplicate_count),
      processed_count = coalesce(p_processed_count, processed_count)
  where id = p_job_id
    and worker_id = p_worker_id
    and status = 'running'
  returning cancel_requested into v_cancel;

  -- No row matched: the claim was lost (job cancelled, or re-claimed by
  -- another worker). Tell the caller to stop.
  return coalesce(v_cancel, true);
end;
$$;

-- ---------------------------------------------------------------------------
--  finish_job — terminal transition.
-- ---------------------------------------------------------------------------

create or replace function finish_job(
  p_job_id        uuid,
  p_worker_id     text,
  p_status        job_status,
  p_error_message text default null,
  p_error_code    text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_status not in ('completed', 'failed', 'cancelled') then
    raise exception 'finish_job requires a terminal status, got %', p_status;
  end if;

  update scraping_jobs
  set status        = p_status,
      error_message = p_error_message,
      error_code    = p_error_code,
      completed_at  = now(),
      heartbeat_at  = null
  where id = p_job_id
    and worker_id = p_worker_id;
end;
$$;

-- ---------------------------------------------------------------------------
--  upsert_lead — insert a scraped lead, or merge it into the existing one.
--
--  Match priority, exactly as specified:
--    1. LinkedIn URL   2. Email   3. Name + company
--
--  On a match the existing row is updated rather than duplicated. Only empty
--  fields are filled in: a value the user has already curated is never
--  overwritten by a later scrape, and `status` and `notes` are never touched
--  at all. Returns 'inserted' or 'updated' so the worker can report an
--  accurate "duplicates skipped" count.
--
--  The insert is wrapped in a unique_violation handler because three separate
--  unique indexes can each reject it; on collision we re-run the lookup and
--  merge instead. That makes concurrent workers and mid-job restarts safe.
-- ---------------------------------------------------------------------------

create type upsert_lead_result as (
  lead_id uuid,
  action  text
);

create or replace function upsert_lead(
  p_user_id              uuid,
  p_job_id               uuid,
  p_full_name            text,
  p_first_name           text default null,
  p_last_name            text default null,
  p_job_title            text default null,
  p_company_name         text default null,
  p_company_website      text default null,
  p_company_linkedin_url text default null,
  p_linkedin_url         text default null,
  p_location             text default null,
  p_country              text default null,
  p_industry             text default null,
  p_company_size         text default null,
  p_email                text default null,
  p_phone                text default null,
  p_mobile_phone         text default null,
  p_source               text default 'linkedin',
  p_source_url           text default null
)
returns upsert_lead_result
language plpgsql
security definer
set search_path = public
as $$
declare
  v_linkedin_key text;
  v_email_key    text;
  v_name_key     text;
  v_existing     uuid;
  v_result       upsert_lead_result;
begin
  if p_full_name is null or length(trim(p_full_name)) = 0 then
    raise exception 'upsert_lead requires a non-empty full_name';
  end if;

  -- Same key functions the generated columns use, so the lookup and the
  -- constraint can never disagree.
  v_linkedin_key := lead_linkedin_url_key(p_linkedin_url);
  v_email_key    := lead_email_key(p_email);
  v_name_key     := lead_name_company_key(p_full_name, p_company_name);

  -- Priority 1: LinkedIn URL
  if v_linkedin_key is not null then
    select id into v_existing from leads
    where user_id = p_user_id and linkedin_url_key = v_linkedin_key;
  end if;

  -- Priority 2: email
  if v_existing is null and v_email_key is not null then
    select id into v_existing from leads
    where user_id = p_user_id and email_key = v_email_key;
  end if;

  -- Priority 3: name + company
  if v_existing is null and v_name_key is not null then
    select id into v_existing from leads
    where user_id = p_user_id and name_company_key = v_name_key;
  end if;

  if v_existing is null then
    begin
      insert into leads (
        user_id, job_id, full_name, first_name, last_name, job_title,
        company_name, company_website, company_linkedin_url, linkedin_url,
        location, country, industry, company_size,
        email, phone, mobile_phone, source, source_url
      ) values (
        p_user_id, p_job_id, p_full_name, p_first_name, p_last_name, p_job_title,
        p_company_name, p_company_website, p_company_linkedin_url, p_linkedin_url,
        p_location, p_country, p_industry, p_company_size,
        p_email, p_phone, p_mobile_phone, p_source, p_source_url
      )
      returning id into v_existing;

      v_result := (v_existing, 'inserted')::upsert_lead_result;
      return v_result;
    exception when unique_violation then
      -- Another writer got there first; fall through to the merge below.
      select id into v_existing from leads
      where user_id = p_user_id
        and (
          (v_linkedin_key is not null and linkedin_url_key = v_linkedin_key)
          or (v_email_key is not null and email_key = v_email_key)
          or (v_name_key is not null and name_company_key = v_name_key)
        )
      limit 1;

      if v_existing is null then
        raise;
      end if;
    end;
  end if;

  -- Merge: fill gaps only, never clobber curated data.
  update leads
  set first_name           = coalesce(first_name, p_first_name),
      last_name            = coalesce(last_name, p_last_name),
      job_title            = coalesce(job_title, p_job_title),
      company_name         = coalesce(company_name, p_company_name),
      company_website      = coalesce(company_website, p_company_website),
      company_linkedin_url = coalesce(company_linkedin_url, p_company_linkedin_url),
      linkedin_url         = coalesce(linkedin_url, p_linkedin_url),
      location             = coalesce(location, p_location),
      country              = coalesce(country, p_country),
      industry             = coalesce(industry, p_industry),
      company_size         = coalesce(company_size, p_company_size),
      email                = coalesce(email, p_email),
      phone                = coalesce(phone, p_phone),
      mobile_phone         = coalesce(mobile_phone, p_mobile_phone),
      source_url           = coalesce(source_url, p_source_url)
  where id = v_existing;

  v_result := (v_existing, 'updated')::upsert_lead_result;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
--  Permissions: these functions are for the worker (service role) only.
--  Revoke the default grant so an authenticated browser session cannot call
--  them and write on another user's behalf.
-- ---------------------------------------------------------------------------

revoke execute on function claim_next_job(text, interval) from public, anon, authenticated;
revoke execute on function job_heartbeat(uuid, text, integer, integer, integer) from public, anon, authenticated;
revoke execute on function finish_job(uuid, text, job_status, text, text) from public, anon, authenticated;
revoke execute on function upsert_lead(
  uuid, uuid, text, text, text, text, text, text, text, text,
  text, text, text, text, text, text, text, text, text
) from public, anon, authenticated;
