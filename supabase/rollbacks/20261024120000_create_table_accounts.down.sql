begin;

-- Destructive: only for a database that never operated for real. It drops the
-- sessions, the ledger and every payment, discount and decision recorded on it.

-- Puts the T19 placeholders back in the salon view.
do $unpatch$
declare
  definition text;
  session_expression constant text :=
    $e$'session', (select jsonb_build_object('id', account_session.id)
      from private.table_sessions account_session
      where account_session.tenant_id = target_tenant_id
        and account_session.location_id = target_location_id
        and account_session.status = 'open'
        and account_session.scope_key = units.id),$e$;
  balance_expression constant text :=
    $e$'balanceCents', (select (private.account_summary(
        target_tenant_id, target_location_id, account_session.id) ->> 'pendingCents')::integer
      from private.table_sessions account_session
      where account_session.tenant_id = target_tenant_id
        and account_session.location_id = target_location_id
        and account_session.status = 'open'
        and account_session.scope_key = units.id),$e$;
begin
  select pg_get_functiondef('private.waiter_salon_view(uuid,uuid,uuid)'::regprocedure)
  into definition;
  definition := replace(definition, session_expression, $e$'session', null,$e$);
  definition := replace(definition, balance_expression, $e$'balanceCents', null,$e$);
  execute definition;
end
$unpatch$;

drop function if exists private.keep_account_open(uuid, uuid, uuid, uuid, uuid);
drop function if exists private.apply_account_discount(uuid, uuid, uuid, uuid, uuid, text, integer, text);
drop function if exists private.record_account_payment(uuid, uuid, uuid, uuid, uuid, text, integer, integer);
drop function if exists private.waiter_accounts_view(uuid, uuid, uuid);
drop function if exists private.waiter_serves_session(uuid, uuid, uuid, text, uuid);

drop trigger if exists order_adjustments_reverse_item on private.order_adjustments;
drop trigger if exists confirmed_order_items_charge on private.confirmed_order_items;
drop trigger if exists confirmed_orders_assign_session on private.confirmed_orders;
drop function if exists private.reverse_adjusted_item();
drop function if exists private.charge_confirmed_item();
drop function if exists private.assign_order_session();

drop function if exists private.discount_cents_for_percent(integer, integer);
drop function if exists private.verify_account(uuid, uuid, uuid);
drop function if exists private.account_summary(uuid, uuid, uuid);
drop function if exists private.ensure_table_session(uuid, uuid, uuid, uuid);

drop table if exists private.account_decisions;
drop table if exists private.account_entries;
alter table private.confirmed_orders
  drop constraint if exists confirmed_orders_session_fkey,
  drop column if exists session_id;
drop table if exists private.table_sessions;
drop function if exists private.guard_table_session_change();

commit;
