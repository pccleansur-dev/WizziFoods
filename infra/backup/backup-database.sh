#!/usr/bin/env bash
# Physical backup of the platform database (pg_basebackup, consistent, compressed) plus the
# roles, a manifest with the row counts of the tables that matter, and a Prometheus metric
# so the monitoring knows when the last good copy was taken.
#
#   infra/backup/backup-database.sh
#
# Environment (all optional):
#   DB_CONTAINER   container running Postgres            (supabase-db)
#   DB_USER        superuser/replication role             (supabase_admin)
#   BACKUP_DIR     where copies go                        (./backups/database)
#   KEEP           how many copies to keep                (14)
#   METRICS_DIR    node-exporter textfile directory       (./infra/observability/textfile)
#
# The copy is only as good as its last restore: run infra/backup/restore-drill.sh monthly.
set -euo pipefail
umask 077   # copies hold every business's data and the role hashes: owner-only

DB_CONTAINER=${DB_CONTAINER:-supabase-db}
DB_USER=${DB_USER:-supabase_admin}
BACKUP_DIR=${BACKUP_DIR:-./backups/database}
KEEP=${KEEP:-14}
METRICS_DIR=${METRICS_DIR:-./infra/observability/textfile}
here=$(cd "$(dirname "$0")" && pwd)

stamp=$(date -u +%Y%m%dT%H%M%SZ)
dir="$BACKUP_DIR/$stamp"
mkdir -p "$dir"
started=$(date -u +%s)

echo "base backup -> $dir/base.tar.gz"
docker exec "$DB_CONTAINER" pg_basebackup -U "$DB_USER" -D - -Ft -X fetch -z -Z 5 \
  --checkpoint=fast --label="platform-$stamp" > "$dir/base.tar.gz"

echo "roles -> $dir/globals.sql"
docker exec "$DB_CONTAINER" pg_dumpall -U "$DB_USER" --globals-only > "$dir/globals.sql"

# Row counts of the tables that matter, taken right after the copy: the restore must match
# (or exceed, if the system kept working) these numbers.
{
  echo "{"
  echo "  \"stamp\": \"$stamp\","
  echo "  \"postgres\": \"$(docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d postgres -Atc 'show server_version')\","
  echo "  \"image\": \"$(docker inspect "$DB_CONTAINER" --format '{{.Config.Image}}')\","
  echo "  \"counts\": {"
  first=1
  while read -r table; do
    [ -z "$table" ] && continue
    count=$(docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d postgres -Atc "select count(*) from $table")
    [ $first -eq 1 ] || echo ","
    printf '    "%s": %s' "$table" "$count"
    first=0
  done < "$here/verify-tables.txt"
  echo
  echo "  },"
  echo "  \"sha256\": \"$(sha256sum "$dir/base.tar.gz" | cut -d' ' -f1)\","
  echo "  \"bytes\": $(wc -c < "$dir/base.tar.gz"),"
  echo "  \"seconds\": $(( $(date -u +%s) - started ))"
  echo "}"
} > "$dir/manifest.json"

# A copy that cannot be read back is not a copy.
gzip -t "$dir/base.tar.gz"
tar -tzf "$dir/base.tar.gz" > /dev/null

echo "$stamp" > "$BACKUP_DIR/LATEST"

# Retention: keep the newest $KEEP.
ls -1d "$BACKUP_DIR"/[0-9]*T*Z 2>/dev/null | sort | head -n "-$KEEP" | while read -r old; do
  rm -rf "$old"
done

mkdir -p "$METRICS_DIR"
tmp=$(mktemp "$METRICS_DIR/.backup-database.XXXXXX")
cat > "$tmp" <<METRIC
# HELP platform_backup_last_success_timestamp_seconds Unix time of the last good backup.
# TYPE platform_backup_last_success_timestamp_seconds gauge
platform_backup_last_success_timestamp_seconds{kind="database"} $(date -u +%s)
METRIC
mv "$tmp" "$METRICS_DIR/backup-database.prom"

echo "ok: $dir ($(wc -c < "$dir/base.tar.gz") bytes)"
