-- ============================================================================
--  Dashboard aggregates + API rate limiting
-- ============================================================================

-- ---------------------------------------------------------------------------
--  dashboard_stats — one round trip for the /dashboard KPI cards.
--
--  Runs as the caller (SECURITY INVOKER, the default) so RLS still applies and
--  a user can only ever count their own leads.
-- ---------------------------------------------------------------------------

create or replace function dashboard_stats()
returns table (
  total_leads      bigint,
  new_leads        bigint,
  qualified_leads  bigint,
  contacted_leads  bigint,
  meeting_leads    bigint,
  interested_leads bigint,
  running_jobs     bigint
)
language sql
stable
as $$
  select
    (select count(*) from leads where user_id = auth.uid()),
    (select count(*) from leads where user_id = auth.uid() and status = 'new'),
    (select count(*) from leads where user_id = auth.uid() and status = 'qualified'),
    (select count(*) from leads where user_id = auth.uid() and status = 'contacted'),
    (select count(*) from leads where user_id = auth.uid() and status = 'meeting'),
    (select count(*) from leads where user_id = auth.uid() and status = 'interested'),
    (select count(*) from scraping_jobs
      where user_id = auth.uid() and status in ('queued', 'running'));
$$;

-- ---------------------------------------------------------------------------
--  api_rate_limits — fixed-window counters, keyed per user per bucket.
--
--  Vercel functions are stateless and short-lived, so an in-process counter
--  would reset on every cold start and be per-instance anyway. Postgres is the
--  only place a limit can actually be enforced across instances.
-- ---------------------------------------------------------------------------

create table api_rate_limits (
  user_id      uuid        not null references auth.users (id) on delete cascade,
  bucket       text        not null,
  window_start timestamptz not null,
  request_count integer    not null default 0,
  primary key (user_id, bucket, window_start)
);

create index api_rate_limits_window_idx on api_rate_limits (window_start);

alter table api_rate_limits enable row level security;
-- No policies: only the service role touches this table.

-- ---------------------------------------------------------------------------
--  check_rate_limit — count this request and report whether it is allowed.
--
--  Returns true when the request fits inside the window, false when the caller
--  has exceeded p_limit. Called with the service role from API routes.
-- ---------------------------------------------------------------------------

create or replace function check_rate_limit(
  p_user_id         uuid,
  p_bucket          text,
  p_limit           integer,
  p_window_seconds  integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window_start timestamptz;
  v_count        integer;
begin
  -- Snap to a fixed window so concurrent requests share the same counter row.
  v_window_start := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  insert into api_rate_limits (user_id, bucket, window_start, request_count)
  values (p_user_id, p_bucket, v_window_start, 1)
  on conflict (user_id, bucket, window_start)
  do update set request_count = api_rate_limits.request_count + 1
  returning request_count into v_count;

  -- Opportunistic cleanup of long-expired windows.
  if random() < 0.01 then
    delete from api_rate_limits where window_start < now() - interval '1 day';
  end if;

  return v_count <= p_limit;
end;
$$;

revoke execute on function check_rate_limit(uuid, text, integer, integer)
  from public, anon, authenticated;
