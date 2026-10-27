# PITR drill 2026-10-27T05:14:48Z

Image `supabase/postgres:17.6.1.136`, WAL archiving on (`archive_mode=on`, `archive_command` copies each segment to a separate volume).

- [x] base backup taken
Incident: `drop table drill` after the recovery target **2026-10-27 05:15:00.726851+00**.
- [x] the table is gone on the live database (the incident is real)
- [x] WAL segments reached the archive (6 files)

Restored rows: `before the backup | after the backup 1 | after the backup 2` (recovered in 4 s).

- [x] the dropped table is back
- [x] data from before the backup is there
- [x] data written after the backup, before the target, is there (WAL replayed)
- [x] nothing written after the target leaked in
- [x] the restored database is a normal, writable primary

Result: **PASSED**.
