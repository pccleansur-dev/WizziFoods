begin;

drop function if exists private.list_platform_audit_events(uuid, integer);
drop function if exists private.list_platform_tenants(uuid);

commit;
