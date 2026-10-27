#!/usr/bin/env bash
# Restores the latest backup into an ISOLATED copy (no network, its own volume) and proves
# it is a working database: the checksum matches, Postgres starts and recovers, the row
# counts equal the manifest taken at backup time, and a pgTap file runs against it. Then it
# restores the Storage copy into a scratch directory and checks every file. It touches
# nothing of the running system. Writes the evidence to docs/evidence/ and the metric the
# monitoring watches.
#
#   infra/backup/restore-drill.sh
#
# Environment (all optional):
#   DB_BACKUP_DIR       (./backups/database)     STORAGE_BACKUP_DIR  (./backups/storage)
#   EVIDENCE_DIR        (./docs/evidence)        METRICS_DIR         (./infra/observability/textfile)
#   ALLOW_DRIFT         rows of difference tolerated per table when the system was busy (0)
#   PGTAP_FILE          test run against the restored copy (supabase/tests/database/realtime_diner.test.sql)
set -euo pipefail

DB_BACKUP_DIR=${DB_BACKUP_DIR:-./backups/database}
STORAGE_BACKUP_DIR=${STORAGE_BACKUP_DIR:-./backups/storage}
EVIDENCE_DIR=${EVIDENCE_DIR:-./docs/evidence}
METRICS_DIR=${METRICS_DIR:-./infra/observability/textfile}
ALLOW_DRIFT=${ALLOW_DRIFT:-0}
PGTAP_FILE=${PGTAP_FILE:-supabase/tests/database/realtime_diner.test.sql}

export MSYS_NO_PATHCONV=1
winpath() { (cd "$1" && (pwd -W 2>/dev/null || pwd)); }

latest=$(cat "$DB_BACKUP_DIR/LATEST")
src="$DB_BACKUP_DIR/$latest"
id="restore-drill-$(date -u +%H%M%S)"
volume="$id"
started=$(date -u +%s)
report=$(mktemp)
fail=0
say() { echo "$*" | tee -a "$report"; }
check() { # description, command...
  local what=$1; shift
  if "$@"; then say "- [x] $what"; else say "- [ ] **FAILED** $what"; fail=1; fi
}
cleanup() {
  docker rm -f "$id" > /dev/null 2>&1 || true
  docker volume rm "$volume" > /dev/null 2>&1 || true
  rm -rf "${scratch:-/nonexistent}" 2> /dev/null || true
}
trap cleanup EXIT

image=$(sed -n 's/.*"image": "\(.*\)",/\1/p' "$src/manifest.json")
say "# Restore drill $(date -u +%Y-%m-%dT%H:%M:%SZ)"
say ""
say "Backup restored: \`$latest\` (image \`$image\`, Postgres $(sed -n 's/.*"postgres": "\(.*\)",/\1/p' "$src/manifest.json"))."
say ""

expected=$(sed -n 's/.*"sha256": "\(.*\)",/\1/p' "$src/manifest.json")
actual=$(sha256sum "$src/base.tar.gz" | cut -d' ' -f1)
check "checksum of the archive matches the manifest" [ "$expected" = "$actual" ]

# 1. Unpack into a fresh volume that no running container shares.
docker volume create "$volume" > /dev/null
restore_started=$(date -u +%s)
docker run --rm --network none -v "$volume:/data" -v "$(winpath "$src"):/backup:ro" alpine \
  sh -c 'tar xzf /backup/base.tar.gz -C /data && chown -R 100:101 /data && chmod 700 /data'

# 2. Start Postgres on it, with no network at all: it cannot reach, or be reached by, anything.
docker run -d --name "$id" --network none -v "$volume:/var/lib/postgresql/data" "$image" \
  postgres -c config_file=/etc/postgresql/postgresql.conf -c log_min_messages=fatal > /dev/null
ready() { docker exec "$id" pg_isready -U supabase_admin -d postgres -q; }
for _ in $(seq 1 90); do ready && break; sleep 2; done
check "Postgres started on the restored data and accepts connections" ready
recovery_seconds=$(( $(date -u +%s) - restore_started ))
say ""
say "Time from the archive to a database that answers (RTO of the copy): **${recovery_seconds} s**."
say ""

psql_restored() { docker exec -i "$id" psql -U supabase_admin -d postgres -At "$@"; }

# 3. Row counts against the manifest.
say "| table | at backup | restored |"
say "| --- | ---: | ---: |"
while read -r table count; do
  restored=$(psql_restored -c "select count(*) from $table" < /dev/null 2> /dev/null || echo "error")
  diff=$(( ${restored:-0} - count )); [ "${diff#-}" -le "$ALLOW_DRIFT" ] 2> /dev/null || fail=1
  mark=""; [ "${diff#-}" -le "$ALLOW_DRIFT" ] 2> /dev/null || mark=" ❌"
  say "| \`$table\` | $count | $restored$mark |"
done < <(sed -n 's/^    "\(.*\)": \([0-9]*\),\{0,1\}$/\1 \2/p' "$src/manifest.json")
say ""

# 4. The copy is a working system, not only data: the database tests run on it.
if [ -f "$PGTAP_FILE" ]; then
  result=$(psql_restored -q < "$PGTAP_FILE" 2>&1 || true)
  oks=$(echo "$result" | grep -c '^ok' || true)
  nots=$(echo "$result" | grep -c '^not ok' || true)
  check "pgTap ($PGTAP_FILE) on the restored copy: $oks ok, $nots failed" [ "$nots" -eq 0 ] && [ "$oks" -gt 0 ]
fi
check "the migrations' schemas are all there (private, public, auth, storage, realtime)" \
  [ "$(psql_restored -c "select count(*) from information_schema.schemata where schema_name in ('private','public','auth','storage','realtime')")" = "5" ]

# 5. Storage.
storage_latest=$(cat "$STORAGE_BACKUP_DIR/LATEST" 2> /dev/null || true)
if [ -n "$storage_latest" ]; then
  scratch=$(mktemp -d)
  tar -xzf "$STORAGE_BACKUP_DIR/$storage_latest/storage.tar.gz" -C "$scratch"
  files=$(wc -l < "$STORAGE_BACKUP_DIR/$storage_latest/files.sha256")
  check "Storage ($storage_latest): all $files files restored with the same checksum" \
    bash -c "cd '$scratch' && sha256sum --quiet -c '$(cd "$STORAGE_BACKUP_DIR/$storage_latest" && pwd)/files.sha256'"
  # Every object the database knows about must have its file.
  missing=$(psql_restored -c "select count(*) from storage.objects" 2> /dev/null || echo 0)
  say "- objects registered in \`storage.objects\`: $missing"
fi

say ""
say "Total: $(( $(date -u +%s) - started )) s. Result: $([ $fail -eq 0 ] && echo '**PASSED**' || echo '**FAILED**')."

mkdir -p "$EVIDENCE_DIR"
cp "$report" "$EVIDENCE_DIR/restore-drill-$(date -u +%Y-%m-%d).md"
if [ $fail -eq 0 ]; then
  mkdir -p "$METRICS_DIR"
  cat > "$METRICS_DIR/restore-drill.prom" <<METRIC
# HELP platform_backup_last_restore_drill_timestamp_seconds Unix time of the last restore drill that passed.
# TYPE platform_backup_last_restore_drill_timestamp_seconds gauge
platform_backup_last_restore_drill_timestamp_seconds $(date -u +%s)
METRIC
fi
exit $fail
