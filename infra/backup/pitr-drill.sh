#!/usr/bin/env bash
# Point-in-time recovery, end to end, on a scratch database that uses the SAME image and
# configuration as production plus WAL archiving. It simulates the incident PITR exists
# for: somebody drops a table. It restores the base backup, replays the archived WAL up to
# one second BEFORE the mistake, and checks that the data is back and nothing newer than
# the target leaked in. Nothing of the running system is touched.
#
#   infra/backup/pitr-drill.sh
#
# Environment: IMAGE (default: the image of $DB_CONTAINER, supabase-db), EVIDENCE_DIR (./docs/evidence).
set -euo pipefail
export MSYS_NO_PATHCONV=1

DB_CONTAINER=${DB_CONTAINER:-supabase-db}
IMAGE=${IMAGE:-$(docker inspect "$DB_CONTAINER" --format '{{.Config.Image}}')}
EVIDENCE_DIR=${EVIDENCE_DIR:-./docs/evidence}
id="pitr-drill-$(date -u +%H%M%S)"
vols=("$id-data" "$id-archive" "$id-backup" "$id-restored")
report=$(mktemp)
fail=0
say() { echo "$*" | tee -a "$report"; }
check() { local what=$1; shift; if "$@"; then say "- [x] $what"; else say "- [ ] **FAILED** $what"; fail=1; fi; }
cleanup() {
  docker rm -f "$id-a" "$id-b" > /dev/null 2>&1 || true
  for v in "${vols[@]}"; do docker volume rm "$v" > /dev/null 2>&1 || true; done
}
trap cleanup EXIT
for v in "${vols[@]}"; do docker volume create "$v" > /dev/null; done

HBA="$(cd "$(dirname "$0")" && (pwd -W 2>/dev/null || pwd))/pg_hba.conf"
PGCONF=(-c config_file=/etc/postgresql/postgresql.conf -c log_min_messages=fatal -c hba_file=/etc/postgresql-backup/pg_hba.conf)
ARCHIVE=(-c archive_mode=on -c "archive_command=test ! -f /archive/%f && cp %p /archive/%f" -c archive_timeout=10)
psql_in() { docker exec -i "$1" psql -U supabase_admin -d postgres -At "${@:2}"; }
wait_ready() { for _ in $(seq 1 90); do docker exec "$1" pg_isready -U supabase_admin -d postgres -q && return 0; sleep 2; done; return 1; }

say "# PITR drill $(date -u +%Y-%m-%dT%H:%M:%SZ)"
say ""
say "Image \`$IMAGE\`, WAL archiving on (\`archive_mode=on\`, \`archive_command\` copies each segment to a separate volume)."
say ""

# 1. A database that archives its WAL.
docker run -d --name "$id-a" --network none -e POSTGRES_PASSWORD=drill \
  -v "$id-data:/var/lib/postgresql/data" -v "$id-archive:/archive" -v "$id-backup:/backup" \
  -v "$HBA:/etc/postgresql-backup/pg_hba.conf:ro" \
  "$IMAGE" postgres "${PGCONF[@]}" "${ARCHIVE[@]}" > /dev/null
wait_ready "$id-a" || { say "database A never became ready"; exit 1; }
docker exec "$id-a" chown postgres:postgres /archive /backup
psql_in "$id-a" -c "create table drill (id serial primary key, note text, at timestamptz default clock_timestamp())" > /dev/null
psql_in "$id-a" -c "insert into drill (note) values ('before the backup')" > /dev/null

# 2. The base backup.
docker exec -u postgres "$id-a" sh -c "pg_basebackup -U supabase_admin -D - -Ft -X fetch -z --checkpoint=fast > /backup/base.tar.gz"
check "base backup taken" docker exec "$id-a" test -s /backup/base.tar.gz

# 3. Life goes on; then the mistake.
psql_in "$id-a" -c "insert into drill (note) values ('after the backup 1'), ('after the backup 2')" > /dev/null
psql_in "$id-a" -c "select pg_switch_wal()" > /dev/null
sleep 3
target=$(psql_in "$id-a" -c "select to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS.US') || '+00'")
sleep 3
psql_in "$id-a" -c "insert into drill (note) values ('after the target')" > /dev/null
psql_in "$id-a" -c "drop table drill" > /dev/null   # the mistake
psql_in "$id-a" -c "select pg_switch_wal()" > /dev/null
for _ in $(seq 1 30); do
  [ "$(docker exec "$id-a" sh -c 'ls /archive | wc -l')" -ge 3 ] && break; sleep 2
done
say "Incident: \`drop table drill\` after the recovery target **$target**."
check "the table is gone on the live database (the incident is real)" \
  [ "$(psql_in "$id-a" -c "select to_regclass('public.drill') is null")" = "t" ]
check "WAL segments reached the archive ($(docker exec "$id-a" sh -c 'ls /archive | wc -l') files)" \
  [ "$(docker exec "$id-a" sh -c 'ls /archive | wc -l')" -ge 2 ]

# 4. Disaster: the server is gone. Only the base backup and the archive survive.
docker stop "$id-a" > /dev/null
restore_started=$(date -u +%s)
docker run --rm --network none -v "$id-restored:/data" -v "$id-backup:/backup:ro" alpine sh -c "
  tar xzf /backup/base.tar.gz -C /data &&
  touch /data/recovery.signal &&
  printf \"restore_command = 'cp /archive/%%f %%p'\nrecovery_target_time = '$target'\nrecovery_target_action = 'promote'\n\" >> /data/postgresql.auto.conf &&
  chown -R 100:101 /data && chmod 700 /data"
docker run -d --name "$id-b" --network none -v "$id-restored:/var/lib/postgresql/data" -v "$id-archive:/archive:ro" \
  -v "$HBA:/etc/postgresql-backup/pg_hba.conf:ro" \
  "$IMAGE" postgres "${PGCONF[@]}" > /dev/null
wait_ready "$id-b" || { say "restored database never became ready"; docker logs "$id-b" | tail -20; exit 1; }
# Recovery finishes (promote) a moment after it accepts connections.
for _ in $(seq 1 30); do [ "$(psql_in "$id-b" -c 'select pg_is_in_recovery()')" = "f" ] && break; sleep 1; done
rto=$(( $(date -u +%s) - restore_started ))

# 5. What came back.
notes=$(psql_in "$id-b" -c "select string_agg(note, ' | ' order by id) from drill" 2> /dev/null || echo "")
say ""
say "Restored rows: \`$notes\` (recovered in ${rto} s)."
say ""
check "the dropped table is back" [ -n "$notes" ]
check "data from before the backup is there" bash -c "echo '$notes' | grep -q 'before the backup'"
check "data written after the backup, before the target, is there (WAL replayed)" bash -c "echo '$notes' | grep -q 'after the backup 2'"
check "nothing written after the target leaked in" bash -c "! echo '$notes' | grep -q 'after the target'"
check "the restored database is a normal, writable primary" \
  [ "$(psql_in "$id-b" -c 'select pg_is_in_recovery()')" = "f" ]

say ""
say "Result: $([ $fail -eq 0 ] && echo '**PASSED**' || echo '**FAILED**')."
mkdir -p "$EVIDENCE_DIR"
cp "$report" "$EVIDENCE_DIR/pitr-drill-$(date -u +%Y-%m-%d).md"
exit $fail
