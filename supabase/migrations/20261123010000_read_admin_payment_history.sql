begin;

create function private.read_payment_history(
  target_tenant_id uuid,
  target_location_id uuid,
  target_requester_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set row_security = off
as $$
declare
  result jsonb;
begin
  perform private.require_floor_plan_admin(
    target_tenant_id, target_location_id, target_requester_id
  );

  with recent as (
    select session.*, activity.last_at
    from private.table_sessions session
    cross join lateral (
      select greatest(session.opened_at, session.closed_at, max(entry.created_at)) as last_at
      from private.account_entries entry
      where (entry.tenant_id, entry.location_id, entry.session_id) =
        (session.tenant_id, session.location_id, session.id)
    ) activity
    where (session.tenant_id, session.location_id) = (target_tenant_id, target_location_id)
    order by (session.status = 'open') desc, activity.last_at desc, session.id
    limit 100
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', recent.id,
    'tableLabels', coalesce(receipt.body -> 'tableLabels', jsonb_build_array(coalesce(floor_table.label, 'Sin etiqueta'))),
    'status', recent.status,
    'lastAt', recent.last_at,
    'closedAt', recent.closed_at,
    'pendingCents', (summary.value ->> 'pendingCents')::int,
    'paidCents', (summary.value ->> 'paidCents')::int,
    'movements', coalesce(payments.value, '[]'::jsonb)
  ) order by recent.last_at desc, recent.id), '[]'::jsonb)
  into result
  from recent
  left join private.floor_tables floor_table on
    (floor_table.tenant_id, floor_table.location_id, floor_table.id) =
    (recent.tenant_id, recent.location_id, recent.table_id)
  left join private.account_receipts receipt on
    (receipt.tenant_id, receipt.location_id, receipt.session_id) =
    (recent.tenant_id, recent.location_id, recent.id)
  cross join lateral (
    select private.account_summary(recent.tenant_id, recent.location_id, recent.id) as value
  ) summary
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'id', entry.id::text,
      'kind', entry.kind,
      'method', entry.payment_method,
      'amountCents', abs(entry.amount_cents),
      'at', entry.created_at,
      'recordedBy', staff.display_name,
      'payers', coalesce(payers.labels, '[]'::jsonb)
    ) order by entry.created_at desc, entry.id desc) as value
    from private.account_entries entry
    left join public.staff_members staff on
      (staff.tenant_id, staff.id) = (entry.tenant_id, entry.actor_id)
    left join lateral (
      select jsonb_agg(distinct share.payer_label) as labels
      from private.account_splits split
      join private.account_split_shares share on share.split_id = split.id
      where (split.tenant_id, split.location_id, split.session_id) =
        (entry.tenant_id, entry.location_id, entry.session_id)
        and share.payment_id = entry.source_id and share.payer_label is not null
    ) payers on true
    where (entry.tenant_id, entry.location_id, entry.session_id) =
      (recent.tenant_id, recent.location_id, recent.id)
      and entry.kind in ('payment', 'refund')
  ) payments on true;

  return result;
end;
$$;

revoke all on function private.read_payment_history(uuid, uuid, uuid)
from public, anon, authenticated, authenticator;
grant execute on function private.read_payment_history(uuid, uuid, uuid) to authenticator;

commit;
