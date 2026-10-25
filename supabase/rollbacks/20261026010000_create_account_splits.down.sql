begin;

-- Destructive: drops every split and its shares, and takes the split out of the accounts view.
do $unpatch$
declare
  definition text := pg_get_functiondef('private.waiter_accounts_view(uuid,uuid,uuid)'::regprocedure);
  added text := E'      ''split'', private.active_account_split(\n        target_tenant_id, target_location_id, account_session.id),\n';
begin
  if position(added in definition) = 0 then
    raise exception 'the T25 view patch is not in place';
  end if;
  execute replace(definition, added, '');
end;
$unpatch$;

drop function private.pay_split_shares(uuid, uuid, uuid, uuid, uuid, uuid, integer[], text, integer, text);
drop function private.create_account_split(uuid, uuid, uuid, uuid, uuid, integer);
drop function private.active_account_split(uuid, uuid, uuid);
drop table private.account_split_shares;
drop table private.account_splits;
drop function private.guard_split_share_change();
drop function private.guard_split_change();

commit;
