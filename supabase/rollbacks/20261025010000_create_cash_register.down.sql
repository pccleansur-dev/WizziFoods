begin;

-- Destructive: only for a database that never operated for real. It drops the
-- shifts, closures, manual movements and the links of refunds to them, and puts
-- the T22 collection (no register needed) and accounts view back.

create or replace function private.record_account_payment(
  target_tenant_id uuid,
  target_location_id uuid,
  target_staff_id uuid,
  target_command_id uuid,
  target_session_id uuid,
  target_method text,
  target_amount_cents integer,
  target_tip_cents integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_role text := private.waiter_actor_role(
    target_tenant_id, target_location_id, target_staff_id
  );
  stored jsonb;
  tip integer := coalesce(target_tip_cents, 0);
  pending integer;
  pay integer;
  payment_id uuid := gen_random_uuid();
begin
  stored := private.claim_waiter_command(
    target_tenant_id, target_location_id, target_staff_id, target_command_id,
    jsonb_build_object(
      'kind', 'account_payment', 'sessionId', target_session_id,
      'method', target_method, 'amountCents', target_amount_cents,
      'tipCents', target_tip_cents
    )
  );
  if stored is not null then
    return stored;
  end if;
  if target_method not in ('cash', 'credit_card', 'debit_card', 'other_in_person')
    or (target_amount_cents is not null and target_amount_cents <= 0)
    or tip < 0 or tip > 100000000
  then
    raise exception 'invalid payment' using errcode = 'PT212';
  end if;

  perform 1 from private.table_sessions account_session
  where account_session.tenant_id = target_tenant_id
    and account_session.location_id = target_location_id
    and account_session.id = target_session_id
  for update;
  if not found
    or not private.waiter_serves_session(
      target_tenant_id, target_location_id, target_staff_id, actor_role,
      target_session_id
    )
  then
    raise exception 'account not found' using errcode = 'PT201';
  end if;

  pending := (private.account_summary(
    target_tenant_id, target_location_id, target_session_id
  ) ->> 'pendingCents')::integer;
  if pending <= 0 then
    raise exception 'nothing to collect' using errcode = 'PT231';
  end if;
  pay := coalesce(target_amount_cents, pending);
  if pay > pending then
    raise exception 'the payment exceeds the pending balance' using errcode = 'PT230';
  end if;

  if tip > 0 then
    insert into private.account_entries (
      tenant_id, location_id, session_id, kind, amount_cents, origin, cause,
      source_type, source_id, actor_type, actor_id, command_id
    ) values (
      target_tenant_id, target_location_id, target_session_id, 'tip', tip,
      'payment', 'Propina', 'payment', payment_id, 'staff', target_staff_id,
      target_command_id
    );
  end if;
  insert into private.account_entries (
    tenant_id, location_id, session_id, kind, amount_cents, origin, cause,
    source_type, source_id, actor_type, actor_id, payment_method, command_id
  ) values (
    target_tenant_id, target_location_id, target_session_id, 'payment',
    -(pay + tip), 'payment', 'Cobro presencial', 'payment', payment_id,
    'staff', target_staff_id, target_method, target_command_id
  );
  perform private.append_audit_event(
    target_tenant_id, 'staff', target_staff_id, 'account.payment_recorded',
    'Cobro presencial registrado en la cuenta', 'account:' || gen_random_uuid()::text,
    'table_session', target_session_id
  );

  return private.finish_waiter_command(
    target_tenant_id, target_location_id, target_staff_id, target_command_id,
    jsonb_build_object(
      'sessionId', target_session_id,
      'amountCents', pay,
      'tipCents', tip,
      'paymentCents', pay + tip,
      'pendingCents', pending - pay
    )
  );
end;
$$;

do $unpatch$
declare
  definition text;
begin
  select pg_get_functiondef('private.waiter_accounts_view(uuid,uuid,uuid)'::regprocedure)
  into definition;
  definition := replace(
    definition,
    $e$select jsonb_build_object(
    'cashRegisterOpen', private.current_cash_shift_id(
      target_tenant_id, target_location_id) is not null,
    'accounts', coalesce(($e$,
    $e$select jsonb_build_object('accounts', coalesce(($e$
  );
  definition := replace(
    definition,
    $e$'paymentMethod', entry.payment_method,
          'sourceId', entry.source_id,$e$,
    $e$'paymentMethod', entry.payment_method,$e$
  );
  execute definition;
end
$unpatch$;

drop function if exists private.cash_register_view(uuid, uuid, uuid);
drop function if exists private.record_account_refund(uuid, uuid, uuid, uuid, uuid, uuid, integer, uuid, text);
drop function if exists private.close_cash_shift(uuid, uuid, uuid, uuid, integer, text);
drop function if exists private.expected_cash_cents(uuid, uuid, uuid);
drop function if exists private.cash_shift_breakdown(uuid, uuid, uuid);
drop function if exists private.record_cash_movement(uuid, uuid, uuid, uuid, text, integer, text);
drop function if exists private.open_cash_shift(uuid, uuid, uuid, uuid, integer);

-- Refunds only exist from this migration on.
alter table private.account_entries
  drop constraint account_entries_item_link_check,
  drop constraint account_entries_refund_link_check,
  drop constraint account_entries_shift_kind_check,
  drop constraint account_entries_shift_fkey;
drop index if exists private.account_entries_refund_idx;
drop index if exists private.account_entries_shift_idx;
alter table private.account_entries
  drop column item_line_id,
  drop column refund_of_source_id,
  drop column shift_id,
  drop constraint account_entries_source_type_check,
  drop constraint account_entries_origin_check,
  add constraint account_entries_origin_check check (
    origin in (
      'order_confirmed', 'item_cancelled', 'item_replaced', 'payment',
      'discount', 'manual'
    )
  ),
  add constraint account_entries_source_type_check check (
    source_type in ('confirmed_order_item', 'order_adjustment', 'payment', 'discount')
  );

drop function if exists private.current_cash_shift_id(uuid, uuid);
drop table if exists private.cash_movements;
drop table if exists private.cash_shift_closures;
drop table if exists private.cash_shifts;
drop function if exists private.guard_cash_shift_change();

commit;
