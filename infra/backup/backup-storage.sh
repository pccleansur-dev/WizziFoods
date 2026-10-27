#!/usr/bin/env bash
# Copy of the files uploaded by the businesses (logos, photos). Same idea as the database:
# a compressed archive, a checksum of every file, and the metric the monitoring watches.
#
#   infra/backup/backup-storage.sh
#
# Environment (all optional):
#   STORAGE_DIR   the Storage volume                      (./infra/supabase/volumes/storage)
#   BACKUP_DIR    where copies go                         (./backups/storage)
#   KEEP          how many copies to keep                 (14)
#   METRICS_DIR   node-exporter textfile directory        (./infra/observability/textfile)
#
# The database copy and this one describe the same moment only roughly: the object rows
# live in the database (storage.objects) and the bytes here. Restore both from the same
# day and run the check of restore-drill.sh, which lists any row without its file.
set -euo pipefail
umask 077   # copies hold every business's data and the role hashes: owner-only

STORAGE_DIR=${STORAGE_DIR:-./infra/supabase/volumes/storage}
BACKUP_DIR=${BACKUP_DIR:-./backups/storage}
KEEP=${KEEP:-14}
METRICS_DIR=${METRICS_DIR:-./infra/observability/textfile}

[ -d "$STORAGE_DIR" ] || { echo "no storage directory at $STORAGE_DIR" >&2; exit 1; }
stamp=$(date -u +%Y%m%dT%H%M%SZ)
dir="$BACKUP_DIR/$stamp"
mkdir -p "$dir"

tar -czf "$dir/storage.tar.gz" -C "$STORAGE_DIR" .
(cd "$STORAGE_DIR" && find . -type f -print0 | sort -z | xargs -0 -r sha256sum) > "$dir/files.sha256"
tar -tzf "$dir/storage.tar.gz" > /dev/null
echo "$stamp" > "$BACKUP_DIR/LATEST"

ls -1d "$BACKUP_DIR"/[0-9]*T*Z 2>/dev/null | sort | head -n "-$KEEP" | while read -r old; do
  rm -rf "$old"
done

mkdir -p "$METRICS_DIR"
tmp=$(mktemp "$METRICS_DIR/.backup-storage.XXXXXX")
cat > "$tmp" <<METRIC
# HELP platform_backup_last_success_timestamp_seconds Unix time of the last good backup.
# TYPE platform_backup_last_success_timestamp_seconds gauge
platform_backup_last_success_timestamp_seconds{kind="storage"} $(date -u +%s)
METRIC
mv "$tmp" "$METRICS_DIR/backup-storage.prom"

echo "ok: $dir ($(wc -l < "$dir/files.sha256") files)"
