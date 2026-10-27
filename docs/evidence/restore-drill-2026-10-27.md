# Restore drill 2026-10-27T05:13:49Z

Backup restored: `20261027T051254Z` (image `supabase/postgres:17.6.1.136`, Postgres 17.6).

- [x] checksum of the archive matches the manifest
- [x] Postgres started on the restored data and accepts connections

Time from the archive to a database that answers (RTO of the copy): **5 s**.

| table | at backup | restored |
| --- | ---: | ---: |
| `public.tenants` | 5 | 5 |
| `public.tenant_memberships` | 5 | 5 |
| `public.locations` | 5 | 5 |
| `public.staff_members` | 5 | 5 |
| `private.catalog_drafts` | 4 | 4 |
| `private.published_catalogs` | 6 | 6 |
| `private.confirmed_orders` | 0 | 0 |
| `private.account_entries` | 0 | 0 |
| `private.online_payments` | 0 | 0 |
| `private.audit_events` | 14 | 14 |
| `private.messaging_outbox` | 0 | 0 |
| `private.diner_accounts` | 9 | 9 |

- [x] pgTap (supabase/tests/database/realtime_diner.test.sql) on the restored copy: 8 ok, 0 failed
- [x] the migrations' schemas are all there (private, public, auth, storage, realtime)
- [x] Storage (20261027T051254Z): all 30 files restored with the same checksum
- objects registered in `storage.objects`: 29

Total: 13 s. Result: **PASSED**.
