#!/usr/bin/env bash
# Lokalne testy bazy (bez Dockera): (1) migracje na bazie z danymi; (2) świeża baza → nakładka Supabase → migracje → pgTAP.
# W CI ten sam zestaw idzie na prawdziwym Supabase (db.yml: supabase start && supabase test db).
# Zmienne: PGHOST, PGPORT, PGUSER (domyślnie /tmp, 54329, postgres).
set -euo pipefail
cd "$(dirname "$0")/../.."
export PGHOST="${PGHOST:-/tmp}" PGPORT="${PGPORT:-54329}" PGUSER="${PGUSER:-postgres}"
DB="organizer_test"
fresh() {
  psql -q -d postgres -c "drop database if exists $DB with (force)" -c "create database $DB" >/dev/null
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f scripts/db/supabase-shim.sql >/dev/null
}
# 1. Migracje na bazie z danymi (jak produkcja): po migracjach rdzenia zasiew przez RPC, potem reszta i sprawdzenie.
fresh
for f in supabase/migrations/*.sql; do
  # Dane, które przed daną migracją mogły już leżeć na produkcji (scripts/db/upgrade-seed-<migracja>.sql).
  seed="scripts/db/upgrade-seed-$(basename "$f")"
  if [ -f "$seed" ]; then psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$seed" >/dev/null; fi
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f" >/dev/null || { echo "Migracja nie przeszła na bazie z danymi: $f"; exit 1; }
  if [ "$(basename "$f")" = "20261006120200_sync.sql" ]; then psql -q -v ON_ERROR_STOP=1 -d "$DB" -f scripts/db/upgrade-seed.sql >/dev/null; fi
done
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f scripts/db/upgrade-check.sql >/dev/null || { echo "Dane po migracjach niepoprawne"; exit 1; }
# 2. Migracje od zera i pgTAP.
fresh
for f in supabase/migrations/*.sql; do
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f" >/dev/null || { echo "Migracja nie przeszła: $f"; exit 1; }
done
pg_prove -d "$DB" --ext .sql -r supabase/tests "$@"
