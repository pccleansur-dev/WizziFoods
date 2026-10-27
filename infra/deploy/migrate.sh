#!/bin/sh
# Applies the pending migrations of supabase/migrations, in name order, and remembers which
# ones ran (supabase_migrations.platform_migrations, with a checksum of each file).
#
#   migrate.sh            apply what is pending
#   migrate.sh --baseline record every migration as applied WITHOUT running it (for a database
#                         that was migrated by hand, once)
#   migrate.sh --status   list applied and pending
#
# Environment: MIGRATION_DATABASE_URL (a role that owns the schema, e.g. supabase_admin),
# MIGRATIONS_DIR (default /migrations). It never edits an applied file's record: if a
# migration changed after it ran, it stops and says which, because a released migration is
# immutable (changes go in a new one). Each file is its own transaction.
set -eu
export PGOPTIONS="-c client_min_messages=warning"

DIR=${MIGRATIONS_DIR:-/migrations}
URL=${MIGRATION_DATABASE_URL:?set MIGRATION_DATABASE_URL}
MODE=${1:-apply}

psql_q() { psql "$URL" -v ON_ERROR_STOP=1 -X -q -t -A "$@"; }

psql_q -c "create schema if not exists supabase_migrations;
  create table if not exists supabase_migrations.platform_migrations (
    name text primary key,
    checksum text not null,
    applied_at timestamptz not null default now()
  );" > /dev/null

# Run it as a single one-shot job (the compose file does): two at once could apply the same file.
applied=0
for file in $(ls "$DIR"/*.sql | sort); do
  name=$(basename "$file")
  sum=$(sha256sum "$file" | cut -d' ' -f1)
  known=$(psql_q -c "select checksum from supabase_migrations.platform_migrations where name = '$name'")
  if [ -n "$known" ]; then
    if [ "$known" != "$sum" ]; then
      echo "ERROR: $name changed after it was applied (recorded $known, now $sum)." >&2
      echo "A released migration is immutable: put the change in a new migration." >&2
      exit 1
    fi
    [ "$MODE" = "--status" ] && echo "applied  $name"
    continue
  fi
  case "$MODE" in
    --status) echo "pending  $name" ;;
    --baseline)
      psql_q -c "insert into supabase_migrations.platform_migrations (name, checksum) values ('$name', '$sum')" > /dev/null
      echo "baseline $name" ;;
    *)
      echo "applying $name"
      psql "$URL" -v ON_ERROR_STOP=1 -X -q -f "$file"
      psql_q -c "insert into supabase_migrations.platform_migrations (name, checksum) values ('$name', '$sum')" > /dev/null
      applied=$((applied + 1)) ;;
  esac
done

[ "$MODE" = "apply" ] && echo "done: $applied migration(s) applied"
exit 0
