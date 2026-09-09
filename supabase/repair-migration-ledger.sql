-- ===========================================================================
--  Repair the migration ledger after applying the schema by hand.
--
--  WHEN YOU NEED THIS
--
--  If you created the schema by pasting supabase/migrations/*.sql into the
--  Supabase SQL editor, the objects exist but nothing recorded that the
--  migrations ran — that bookkeeping is done by `supabase db push`, not by the
--  SQL editor. The Supabase GitHub integration then believes the database is
--  empty, tries to apply 0001_init.sql on the next push to main, and fails:
--
--      ERROR: type "job_status" already exists (SQLSTATE 42710)
--
--  It will fail that way on every push until the ledger is corrected.
--
--  WHAT THIS DOES
--
--  Records 0001..0004 as already applied. It creates no tables, changes no
--  data and touches nothing in the public schema — it only writes four rows of
--  bookkeeping, so the integration skips those four files and applies only
--  migrations added later.
--
--  HOW TO RUN IT
--
--  Paste the whole file into the Supabase SQL editor and press Run. Safe to
--  run twice.
--
--  DO NOT RUN THIS if the schema is not actually there. It would mark the
--  migrations applied without applying them, and the integration would then
--  skip the files that create your tables. Check first:
--
--      select table_name from information_schema.tables
--      where table_schema = 'public' order by 1;
--
--  You should see api_rate_limits, job_logs, leads, scraping_jobs and
--  user_settings. If you do not, run the migrations instead of this file.
-- ===========================================================================

create schema if not exists supabase_migrations;

-- Only the version column is declared. A Supabase project normally already has
-- this table, and its exact columns vary by CLI version — older ones have no
-- `name` column. Naming only the primary key means this works whether the
-- table already exists in either shape or has to be created here.
create table if not exists supabase_migrations.schema_migrations (
  version text primary key
);

insert into supabase_migrations.schema_migrations (version)
values ('0001'),
       ('0002'),
       ('0003'),
       ('0004')
on conflict (version) do nothing;

-- What the integration will now consider applied.
select version from supabase_migrations.schema_migrations order by version;
