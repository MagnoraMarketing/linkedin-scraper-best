#!/usr/bin/env bash
#
# Applies every migration to a throwaway Postgres and runs the schema tests.
#
# Needs a local PostgreSQL 14+ with the `unaccent` extension available
# (postgresql-contrib). Nothing is written to your Supabase project.
#
#   ./scripts/test-db.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGBIN="${PGBIN:-$(dirname "$(command -v initdb || echo /usr/lib/postgresql/16/bin/initdb)")}"
export PATH="$PGBIN:$PATH"

WORKDIR="$(mktemp -d)"
PGDATA="$WORKDIR/data"
PGSOCK="$WORKDIR/sock"
PGPORT="${PGPORT:-5433}"
DB=leadtest

cleanup() {
  pg_ctl -D "$PGDATA" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

mkdir -p "$PGSOCK"
initdb -D "$PGDATA" -U postgres --auth=trust >/dev/null
pg_ctl -D "$PGDATA" -o "-k $PGSOCK -p $PGPORT -c listen_addresses=" -l "$WORKDIR/pg.log" start >/dev/null

export PGHOST="$PGSOCK" PGPORT PGUSER=postgres

psql -q -c "create database $DB"

# Supabase supplies auth.users, auth.uid() and the anon/authenticated roles.
# Stub them so the migrations run unmodified.
psql -q -d "$DB" <<'SQL'
create schema if not exists auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
create or replace function auth.uid() returns uuid language sql stable as $fn$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$fn$;
create role authenticated;
create role anon;
SQL

echo "==> applying migrations"
for file in "$ROOT"/supabase/migrations/*.sql; do
  echo "    $(basename "$file")"
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$file"
done

echo "==> running schema tests"
OUTPUT="$(psql -v ON_ERROR_STOP=1 -d "$DB" -f "$ROOT/supabase/tests/schema_test.sql" 2>&1)"
echo "$OUTPUT"

if echo "$OUTPUT" | grep -q ': *false'; then
  echo
  echo "FAIL: at least one assertion returned false"
  exit 1
fi

echo "==> running denial tests (each must be rejected)"
for file in "$ROOT"/supabase/tests/*_denial*_test.sql; do
  [ -e "$file" ] || continue
  name="$(basename "$file")"
  if psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$file" >/dev/null 2>&1; then
    echo "FAIL: $name succeeded but should have been denied"
    exit 1
  fi
  echo "    $name correctly denied"
done

echo
echo "PASS: schema, duplicate detection, job queue and RLS all behave as specified"
