begin;

-- Destructive: only for a database that never took a real online payment. It drops
-- the connections, attempts and notification log, and puts the T22/T23 behavior
-- back. It refuses to run when an order was confirmed by the system or a table
-- session was opened without staff, because those rows could not be kept.

do $guard$
begin
  if exists (select 1 from private.confirmed_orders where confirmed_by is null)
    or exists (select 1 from private.table_sessions where opened_by is null)
    or exists (select 1 from private.account_entries where payment_method = 'mercado_pago')
  then
    raise exception 'online payments exist: this migration cannot be rolled back';
  end if;
end;
$guard$;

drop function private.finish_mp_webhook_event(text, text);
drop function private.claim_mp_webhook_event(text, uuid, uuid, text, text);
drop function private.online_payments_needing_refund(integer);
drop function private.prepare_online_refund(uuid, uuid, uuid, uuid, uuid, integer, text);
drop function private.reconcile_online_payment(uuid, uuid, uuid, text, text, text, text, integer, integer, timestamptz);
drop function private.diner_online_payment_view(uuid, uuid, text, uuid);
drop function private.begin_diner_online_payment(uuid, uuid, text, uuid);
drop function private.diner_owns_intent(uuid, uuid, text, uuid);
drop function private.online_payment_view(uuid, uuid, uuid);
drop function private.begin_online_payment(uuid, uuid, uuid);
drop function private.resolve_mp_account(text);
drop function private.replace_mp_credentials(uuid, uuid, bytea, smallint);
drop function private.read_mp_credentials(uuid, uuid);
drop function private.disconnect_mp(uuid, uuid, uuid);
drop function private.finish_mp_connection(uuid, uuid, uuid, text, boolean, text, bytea, smallint);
drop function private.consume_mp_oauth_state(bytea);
drop function private.begin_mp_oauth(uuid, uuid, uuid, bytea, integer);

drop function private.online_payment_json(private.online_payments);
drop table private.mp_webhook_events;
drop table private.online_payments;
drop function private.guard_online_payment_change();
drop table private.mp_oauth_states;
drop table private.mp_connections;

alter table private.account_entries drop constraint account_entries_online_not_in_shift;
alter table private.account_entries drop constraint account_entries_payment_method_check;
alter table private.account_entries
  add constraint account_entries_payment_method_check
    check (payment_method in ('cash', 'credit_card', 'debit_card', 'other_in_person'));

alter table private.audit_events drop constraint audit_events_actor_type_check;
alter table private.audit_events
  add constraint audit_events_actor_type_check check (
    actor_type in ('platform_superadmin', 'tenant_admin', 'staff', 'support')
  );

create or replace function private.guard_order_intent_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'awaiting_waiter'
    or new.status not in ('confirmed', 'rejected')
    or (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status')
  then
    raise exception 'an order intent may only be decided once' using errcode = 'PT209';
  end if;
  return new;
end;
$$;

alter table private.order_intents drop constraint order_intents_status_path_check;
alter table private.order_intents
  add constraint order_intents_status_path_check check (
    (payment_path = 'online' and status = 'payment_pending')
    or (payment_path = 'in_person' and status in ('awaiting_waiter', 'confirmed', 'rejected'))
  );

create or replace function private.charge_confirmed_item()
returns trigger
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  order_row private.confirmed_orders%rowtype;
begin
  if new.total_cents <= 0 then
    return new;
  end if;
  select * into order_row
  from private.confirmed_orders confirmed
  where confirmed.tenant_id = new.tenant_id
    and confirmed.location_id = new.location_id
    and confirmed.id = new.order_id;
  if order_row.session_id is null then
    return new;
  end if;
  insert into private.account_entries (
    tenant_id, location_id, session_id, order_id, kind, amount_cents, origin,
    cause, source_type, source_id, actor_type, actor_id, command_id
  ) values (
    new.tenant_id, new.location_id, order_row.session_id, new.order_id, 'charge',
    new.total_cents, 'order_confirmed',
    'Ítem confirmado: ' || left(new.title, 160), 'confirmed_order_item',
    new.line_id, 'staff', order_row.confirmed_by, order_row.command_id
  );
  return new;
end;
$$;

-- Undo the two function patches by removing exactly what the migration added.
do $unpatch$
declare
  refund_def text := pg_get_functiondef(
    'private.record_account_refund(uuid,uuid,uuid,uuid,uuid,uuid,integer,uuid,text)'::regprocedure
  );
  refund_added text := E'  if payment_entry.payment_method = ''mercado_pago'' then\n'
    || E'    raise exception ''online payments are refunded through Mercado Pago'' using errcode = ''PT243'';\n'
    || E'  end if;\n';
  order_def text := pg_get_functiondef(
    'private.append_confirmed_order(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb)'::regprocedure
  );
  actor_added text := E'    target_tenant_id,\n'
    || E'    case when target_staff_id is null then ''system'' else ''staff'' end,\n'
    || E'    coalesce(target_staff_id, ''00000000-0000-4000-8000-000000000000''::uuid),\n'
    || E'    case when target_intent_id is null then ''order.manual_confirmed''';
  reason_added text := E'         when target_staff_id is null then ''Pedido del comensal confirmado por un pago acreditado''\n';
begin
  if position(refund_added in refund_def) = 0
    or position(actor_added in order_def) = 0
    or position(reason_added in order_def) = 0
  then
    raise exception 'the T24 function patches are not in place';
  end if;
  execute replace(refund_def, refund_added, '');
  execute replace(
    replace(order_def, reason_added, ''),
    actor_added,
    E'    target_tenant_id, ''staff'', target_staff_id,\n    case when target_intent_id is null then ''order.manual_confirmed'''
  );
end;
$unpatch$;

alter table private.table_sessions alter column opened_by set not null;
alter table private.confirmed_orders drop constraint confirmed_orders_actor_check;
alter table private.confirmed_orders alter column confirmed_by set not null;

commit;
