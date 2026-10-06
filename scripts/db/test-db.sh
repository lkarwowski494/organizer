#!/usr/bin/env bash
# Lokalne testy bazy (bez Dockera): świeża baza → nakładka Supabase → migracje po kolei → pgTAP.
# W CI ten sam zestaw idzie na prawdziwym Supabase (db.yml: supabase start && supabase test db).
# Zmienne: PGHOST, PGPORT, PGUSER (domyślnie /tmp, 54329, postgres).
set -euo pipefail
cd "$(dirname "$0")/../.."
export PGHOST="${PGHOST:-/tmp}" PGPORT="${PGPORT:-54329}" PGUSER="${PGUSER:-postgres}"
DB="organizer_test"
psql -q -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f scripts/db/supabase-shim.sql >/dev/null
for f in supabase/migrations/*.sql; do
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f" >/dev/null || { echo "Migracja nie przeszła: $f"; exit 1; }
done
pg_prove -d "$DB" --ext .sql -r supabase/tests "$@"
