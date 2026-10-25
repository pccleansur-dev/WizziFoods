begin;

do $unpatch$
declare
  definition text := pg_get_functiondef('private.waiter_accounts_view(uuid,uuid,uuid)'::regprocedure);
  added text := E'      ''liveItems'', private.account_live_items(\n        target_tenant_id, target_location_id, account_session.id),\n';
begin
  if position(added in definition) = 0 then
    raise exception 'the live items view patch is not in place';
  end if;
  execute replace(definition, added, '');
end;
$unpatch$;
drop function private.account_live_items(uuid, uuid, uuid);

commit;
