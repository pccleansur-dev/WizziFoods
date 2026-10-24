begin;

drop function if exists private.create_manual_order(uuid, uuid, uuid, uuid, uuid, text, text, text, jsonb);
drop function if exists private.decide_order_intent(uuid, uuid, uuid, uuid, uuid, text, text);
drop function if exists private.claim_waiter_call(uuid, uuid, uuid, uuid, uuid);
drop function if exists private.waiter_salon_view(uuid, uuid, uuid);
drop function if exists private.assert_table_accepts_orders(uuid, uuid, uuid);
drop function if exists private.append_confirmed_order(uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, jsonb);
drop function if exists private.quote_and_reserve_lines(uuid, uuid, jsonb, boolean);
drop function if exists private.finish_waiter_command(uuid, uuid, uuid, uuid, jsonb);
drop function if exists private.claim_waiter_command(uuid, uuid, uuid, uuid, jsonb);
drop function if exists private.waiter_table_state(uuid, uuid, uuid);
drop function if exists private.waiter_serves_table(uuid, uuid, uuid, text, uuid);
drop function if exists private.waiter_actor_role(uuid, uuid, uuid);

-- Confirmed orders are append-only: dropping them is destructive and only
-- meant for a database that never operated for real.
drop table if exists private.confirmed_order_items;
drop table if exists private.confirmed_orders;
drop table if exists private.order_intent_decisions;
drop table if exists private.waiter_commands;

alter table private.waiter_calls
  drop constraint if exists waiter_calls_claim_state,
  drop constraint if exists waiter_calls_claimed_by_fkey,
  drop column if exists claimed_at,
  drop column if exists claimed_by;

drop trigger if exists order_intents_guard_change on private.order_intents;
drop function if exists private.guard_order_intent_change();
drop function if exists private.reject_append_only_change();

-- T18 knows nothing about decided intents: remove them (destructive, like the
-- order tables above) so its original constraints can be restored.
delete from private.waiter_calls
where intent_id in (select id from private.order_intents where status in ('confirmed', 'rejected'));
delete from private.order_intent_items
where intent_id in (select id from private.order_intents where status in ('confirmed', 'rejected'));
delete from private.order_intents where status in ('confirmed', 'rejected');

alter table private.order_intents drop constraint order_intents_status_path_check;
alter table private.order_intents drop constraint order_intents_status_check;
alter table private.order_intents
  add constraint order_intents_status_check
    check (status in ('awaiting_waiter', 'payment_pending')),
  add constraint order_intents_check2 check (
    (payment_path = 'online' and status = 'payment_pending')
    or (payment_path = 'in_person' and status = 'awaiting_waiter')
  );

commit;
