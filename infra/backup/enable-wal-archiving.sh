#!/usr/bin/env bash
# Recreates the database service with WAL archiving and the local replication rule
# (infra/backup/docker-compose.backup.yml), then makes the archive writable by Postgres and
# proves a WAL segment reaches it. The database restarts (a few seconds).
#
#   infra/backup/enable-wal-archiving.sh
#
# Environment: SUPABASE_DIR (infra/supabase), BACKUP_CONF_DIR (infra/backup, absolute).
set -euo pipefail
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")/../.."
SUPABASE_DIR=${SUPABASE_DIR:-infra/supabase}
ROOT=$(pwd -W 2>/dev/null || pwd)   # a Windows path under Git Bash, the plain path elsewhere
export BACKUP_CONF_DIR=${BACKUP_CONF_DIR:-$ROOT/infra/backup}

compose=(docker compose --project-directory "$SUPABASE_DIR" --env-file "$SUPABASE_DIR/.env"
  -f "$SUPABASE_DIR/docker-compose.yml" -f "$SUPABASE_DIR/docker-compose.local.yml"
  -f "$ROOT/infra/backup/docker-compose.backup.yml")

"${compose[@]}" up -d --no-deps db
docker exec -u root supabase-db chown postgres:postgres /wal-archive
for _ in $(seq 1 60); do docker exec supabase-db pg_isready -U supabase_admin -q && break; sleep 2; done

docker exec supabase-db psql -U supabase_admin -d postgres -Atc "select pg_switch_wal()" > /dev/null
for _ in $(seq 1 30); do
  [ "$(docker exec supabase-db psql -U supabase_admin -d postgres -Atc 'select archived_count from pg_stat_archiver')" -gt 0 ] && break
  sleep 2
done
echo "archive_mode: $(docker exec supabase-db psql -U supabase_admin -d postgres -Atc 'show archive_mode')"
echo "archived segments: $(docker exec supabase-db psql -U supabase_admin -d postgres -Atc 'select archived_count from pg_stat_archiver') (last: $(docker exec supabase-db psql -U supabase_admin -d postgres -Atc 'select last_archived_wal from pg_stat_archiver'))"
docker exec supabase-db psql -U supabase_admin -d postgres -Atc 'select failed_count from pg_stat_archiver' | grep -qx 0 || { echo "WAL archiving is failing" >&2; exit 1; }
