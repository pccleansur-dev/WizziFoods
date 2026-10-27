# Rollback drill 2026-10-27T05:21:28.319Z

Migrations undone (newest first): 20261101020000_revoke_guard_trigger_execute.sql, 20261101010000_translation_review_gate.sql, 20261031020000_realtime_diner_tables.sql, 20261031010000_realtime_invalidation.sql
- before: 1480 database assertions, 0 failing files
- rolled back 20261101020000_revoke_guard_trigger_execute.sql: ok
- rolled back 20261101010000_translation_review_gate.sql: ok
- rolled back 20261031020000_realtime_diner_tables.sql: ok
- rolled back 20261031010000_realtime_invalidation.sql: ok
- the objects of the undone migrations are gone: t
- applied again 20261031010000_realtime_invalidation.sql: ok
- applied again 20261031020000_realtime_diner_tables.sql: ok
- applied again 20261101010000_translation_review_gate.sql: ok
- applied again 20261101020000_revoke_guard_trigger_execute.sql: ok
- after: 1480 database assertions, 0 failing files

Result: PASSED
