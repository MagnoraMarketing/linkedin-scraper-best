-- ============================================================================
--  Schema test suite
--
--  Verifies the parts of the schema that carry real risk: duplicate detection,
--  the job queue's restart safety, and Row Level Security. Run with
--  scripts/test-db.sh, which spins up a throwaway Postgres, applies every
--  migration and executes this file.
--
--  Every check prints "<name>: true". Any "false" is a failure.
-- ============================================================================

\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

\set u1 '11111111-1111-1111-1111-111111111111'
\set u2 '33333333-3333-3333-3333-333333333333'
\set j1 '22222222-2222-2222-2222-222222222222'
\set j2 '44444444-4444-4444-4444-444444444444'

insert into auth.users (id, email) values (:'u1', 'a@test.dk'), (:'u2', 'b@test.dk');

insert into scraping_jobs (id, user_id, job_titles, country, requested_count)
values (:'j1', :'u1', array['CFO'], 'DK', 10),
       (:'j2', :'u2', array['CEO'], 'DK', 10);

\echo '--- key functions (must match lib/leads/dedupe.ts) ---'

select 'linkedin key value:        ' ||
  (lead_linkedin_url_key('https://www.linkedin.com/in/Jens-Hansen-123/?x=1') = '/in/jens-hansen-123')::text;

select 'url variants collapse:     ' || (count(distinct k) = 1)::text
from unnest(array[
  'https://www.linkedin.com/in/jens-hansen-123',
  'https://www.linkedin.com/in/jens-hansen-123/',
  'https://linkedin.com/in/jens-hansen-123',
  'http://dk.linkedin.com/in/jens-hansen-123',
  'https://www.linkedin.com/in/Jens-Hansen-123?utm_source=share',
  'https://www.linkedin.com/in/jens-hansen-123#profile',
  '  https://www.linkedin.com/in/JENS-HANSEN-123//  '
]) u, lateral lead_linkedin_url_key(u) k;

select 'distinct profiles differ:  ' ||
  (lead_linkedin_url_key('https://linkedin.com/in/jens-hansen')
   <> lead_linkedin_url_key('https://linkedin.com/in/jens-hansen-2'))::text;

select 'empty url key is null:     ' || (lead_linkedin_url_key('https://www.linkedin.com/') is null)::text;
select 'email key normalised:      ' || (lead_email_key('  Jens@Firma.DK ') = 'jens@firma.dk')::text;
select 'danish folding:            ' ||
  (lead_name_company_key('Søren Ø. Bak', 'A/S Bak & Co.')
   = lead_name_company_key('Soren O Bak', 'AS Bak Co'))::text;
select 'accent folding:            ' ||
  (lead_name_company_key('José Peña', 'Acme') = lead_name_company_key('Jose Pena', 'Acme'))::text;
select 'name/company not swappable:' ||
  (lead_name_company_key('Acme', 'Jens Hansen') <> lead_name_company_key('Jens Hansen', 'Acme'))::text;
select 'empty name key is null:    ' || (lead_name_company_key('', '') is null)::text;
select 'name key matches TS value: ' || (lead_name_company_key('Jens Hansen', 'Acme') = 'jens hansen|acme')::text;

\echo '--- duplicate detection (priority: url > email > name+company) ---'

select 'new lead inserted:         ' || (action = 'inserted')::text
from upsert_lead(:'u1', :'j1', 'Jens Hansen',
  p_company_name := 'Acme A/S', p_linkedin_url := 'https://www.linkedin.com/in/jens-hansen-123');

select 'matched on linkedin url:   ' || (action = 'updated')::text
from upsert_lead(:'u1', :'j1', 'J. Hansen',
  p_company_name := 'Elsewhere', p_linkedin_url := 'http://dk.linkedin.com/in/JENS-HANSEN-123/?x=1');

select 'lead with email inserted:  ' || (action = 'inserted')::text
from upsert_lead(:'u1', :'j1', 'Mette Nielsen', p_company_name := 'Beta ApS', p_email := 'mette@beta.dk');

select 'matched on email:          ' || (action = 'updated')::text
from upsert_lead(:'u1', :'j1', 'M. Nielsen', p_company_name := 'Gamma', p_email := 'METTE@beta.dk');

select 'matched on name+company:   ' || (action = 'updated')::text
from upsert_lead(:'u1', :'j1', 'Jens Hansen', p_company_name := 'Acme AS');

select 'distinct lead inserted:    ' || (action = 'inserted')::text
from upsert_lead(:'u1', :'j1', 'Peter Sorensen',
  p_company_name := 'Delta', p_linkedin_url := 'https://linkedin.com/in/peter-sorensen');

select 'exactly 3 leads stored:    ' || (count(*) = 3)::text from leads where user_id = :'u1';

\echo '--- merge fills gaps, never overwrites curated data ---'

update leads set status = 'qualified', notes = 'Called Tuesday', phone = '+45 11 22 33 44'
where user_id = :'u1' and linkedin_url_key = '/in/jens-hansen-123';

select 'rescrape merges:           ' || (action = 'updated')::text
from upsert_lead(:'u1', :'j1', 'Jens Hansen',
  p_company_name := 'Acme A/S', p_linkedin_url := 'https://www.linkedin.com/in/jens-hansen-123',
  p_email := 'jens@acme.dk', p_phone := '+45 99 99 99 99');

select 'empty field filled:        ' || (email = 'jens@acme.dk')::text
from leads where user_id = :'u1' and linkedin_url_key = '/in/jens-hansen-123';
select 'existing value kept:       ' || (phone = '+45 11 22 33 44')::text
from leads where user_id = :'u1' and linkedin_url_key = '/in/jens-hansen-123';
select 'status never overwritten:  ' || (status = 'qualified')::text
from leads where user_id = :'u1' and linkedin_url_key = '/in/jens-hansen-123';
select 'notes never overwritten:   ' || (notes = 'Called Tuesday')::text
from leads where user_id = :'u1' and linkedin_url_key = '/in/jens-hansen-123';

select 'dedupe is per-user:        ' || (action = 'inserted')::text
from upsert_lead(:'u2', :'j2', 'Jens Hansen',
  p_company_name := 'Acme A/S', p_linkedin_url := 'https://www.linkedin.com/in/jens-hansen-123');

\echo '--- job queue ---'

delete from scraping_jobs;
insert into scraping_jobs (id, user_id, job_titles, country, requested_count, created_at)
values ('aaaaaaaa-0000-0000-0000-000000000001', :'u1', array['CFO'], 'DK', 10, now() - interval '2 min'),
       ('aaaaaaaa-0000-0000-0000-000000000002', :'u1', array['CEO'], 'DK', 10, now() - interval '1 min');

select 'claims oldest first:       ' || (id = 'aaaaaaaa-0000-0000-0000-000000000001')::text
from claim_next_job('w1');
select 'claim marks running:       ' || (status = 'running' and worker_id = 'w1')::text
from scraping_jobs where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select 'no double-claim:           ' || (id = 'aaaaaaaa-0000-0000-0000-000000000002')::text
from claim_next_job('w2');
select 'empty queue returns none:  ' || (count(*) = 0)::text from claim_next_job('w3');

select 'heartbeat reports no stop: ' ||
  (job_heartbeat('aaaaaaaa-0000-0000-0000-000000000001', 'w1', 5, 2, 7) = false)::text;
select 'progress published:        ' ||
  (found_count = 5 and duplicate_count = 2 and processed_count = 7)::text
from scraping_jobs where id = 'aaaaaaaa-0000-0000-0000-000000000001';

update scraping_jobs set cancel_requested = true where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select 'cancel surfaced to worker: ' ||
  (job_heartbeat('aaaaaaaa-0000-0000-0000-000000000001', 'w1', 6, 2, 8) = true)::text;

select 'foreign worker told stop:  ' ||
  (job_heartbeat('aaaaaaaa-0000-0000-0000-000000000001', 'w9', 99, 99, 99) = true)::text;
select 'foreign worker wrote none: ' || (found_count = 6)::text
from scraping_jobs where id = 'aaaaaaaa-0000-0000-0000-000000000001';

update scraping_jobs set heartbeat_at = now() - interval '10 min'
where id = 'aaaaaaaa-0000-0000-0000-000000000002';
select 'stale job re-claimed:      ' || (id = 'aaaaaaaa-0000-0000-0000-000000000002')::text
from claim_next_job('w4');
select 'live job not re-claimed:   ' || (count(*) = 0)::text from claim_next_job('w5');

select finish_job('aaaaaaaa-0000-0000-0000-000000000001', 'w1', 'completed');
select 'terminal status recorded:  ' ||
  (status = 'completed' and completed_at is not null and heartbeat_at is null)::text
from scraping_jobs where id = 'aaaaaaaa-0000-0000-0000-000000000001';

\echo '--- row level security ---'

grant usage on schema public to authenticated;
grant select, insert, update, delete on leads, scraping_jobs, user_settings to authenticated;
grant select on job_logs to authenticated;

set role authenticated;
select set_config('request.jwt.claim.sub', :'u1', false);
select 'u1 sees own 3 leads:       ' || (count(*) = 3)::text from leads;
select 'u1 cannot see u2 rows:     ' || (count(*) = 0)::text from leads where user_id = :'u2';
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', :'u2', false);
select 'u2 sees only its own:      ' || (count(*) = 1)::text from leads;

with attempt as (
  update leads set status = 'do_not_contact' where user_id = :'u1' returning 1
)
select 'cross-user update blocked: ' || (count(*) = 0)::text from attempt;

with attempt as (
  delete from leads where user_id = :'u1' returning 1
)
select 'cross-user delete blocked: ' || (count(*) = 0)::text from attempt;
reset role;

\echo 'schema test finished — every line above must read true'
