begin;

-- The items of an account that still count (not cancelled, not replaced), so a split by
-- consumption can offer exactly the ones the database will accept.
create function private.account_live_items(
  target_tenant_id uuid,
  target_location_id uuid,
  target_session_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'lineId', item.line_id,
    'title', item.title,
    'quantity', item.quantity,
    'totalCents', item.total_cents
  ) order by confirmed.confirmed_at, item.position, item.line_id), '[]'::jsonb)
  from private.confirmed_order_items item
  join private.confirmed_orders confirmed
    on confirmed.tenant_id = item.tenant_id
    and confirmed.location_id = item.location_id
    and confirmed.id = item.order_id
  where confirmed.session_id = target_session_id
    and item.tenant_id = target_tenant_id
    and item.location_id = target_location_id
    and item.total_cents > 0
    and not exists (
      select 1 from private.order_adjustments adjustment
      where adjustment.tenant_id = item.tenant_id
        and adjustment.location_id = item.location_id
        and adjustment.order_id = item.order_id
        and adjustment.original_line_id = item.line_id
        and (adjustment.kind = 'cancellation'
          or (adjustment.kind = 'replacement' and adjustment.status = 'accepted')));
$$;
revoke all on function private.account_live_items(uuid, uuid, uuid)
from public, anon, authenticated, authenticator;

do $patch$
declare
  definition text := pg_get_functiondef('private.waiter_accounts_view(uuid,uuid,uuid)'::regprocedure);
  anchor text := E'      ''split'', private.active_account_split(';
begin
  if position(anchor in definition) = 0 then
    raise exception 'waiter_accounts_view changed: patch anchor not found';
  end if;
  execute replace(
    definition, anchor,
    E'      ''liveItems'', private.account_live_items(\n'
      || E'        target_tenant_id, target_location_id, account_session.id),\n'
      || anchor
  );
end;
$patch$;

commit;
