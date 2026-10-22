begin;

drop function if exists private.resolve_active_support_access(uuid, uuid);
drop function if exists private.list_support_access(uuid, uuid);
drop function if exists private.revoke_support_access(uuid, uuid, uuid, text, text);
drop function if exists private.grant_support_access(uuid, uuid, uuid, text, integer, text);
drop table if exists private.support_access_grants;

commit;
