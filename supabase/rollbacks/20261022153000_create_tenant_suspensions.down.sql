begin;

drop function if exists private.complete_commercial_suspension(uuid);
drop function if exists private.request_tenant_suspension(uuid, uuid, text, text, text);
drop function if exists private.can_open_table_session(uuid);
drop table if exists private.tenant_suspensions;

commit;
