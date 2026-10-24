begin;

-- Destructive: only for a database that never operated for real. It drops the
-- adjustments and the delivery / shortage / cancellation entry points, and puts
-- the T20 constraints back (which fails if items already left queued, preparing
-- or ready). The T20 definitions of production_board, production_status_of,
-- guard_production_item_change and enqueue_production_item are restored by
-- re-applying supabase/migrations/20261024100000_create_production.sql
-- (its `create function` statements, after dropping the new versions).

drop function if exists private.waiter_orders_view(uuid, uuid, uuid);
drop function if exists private.cancel_order_item(uuid, uuid, uuid, uuid, uuid, uuid, text);
drop function if exists private.decide_item_replacement(uuid, uuid, uuid, uuid, uuid, text, text);
drop function if exists private.propose_item_replacement(uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid);
drop function if exists private.report_production_exception(uuid, uuid, uuid, uuid, uuid, uuid, text);
drop function if exists private.deliver_order_item(uuid, uuid, uuid, uuid, uuid, uuid);
drop function if exists private.required_reason(text);
drop function if exists private.order_status_of(uuid, uuid, uuid);
drop function if exists private.catalog_unit_quote(uuid, uuid, uuid, uuid);

drop table if exists private.order_adjustments;
drop function if exists private.guard_order_adjustment_change();

alter table private.production_item_events
  drop constraint production_item_events_step_check,
  drop constraint production_item_events_to_status_check,
  drop constraint production_item_events_from_status_check,
  drop column reason,
  add constraint production_item_events_from_status_check
    check (from_status in ('queued', 'preparing')),
  add constraint production_item_events_to_status_check
    check (to_status in ('preparing', 'ready')),
  add constraint production_item_events_check check (
    (from_status = 'queued' and to_status = 'preparing')
    or (from_status = 'preparing' and to_status = 'ready'));

alter table private.production_items
  drop constraint production_items_delivered_check,
  drop constraint production_items_ready_check,
  drop constraint production_items_queued_check,
  drop constraint production_items_status_check,
  drop column delivered_at,
  add constraint production_items_status_check
    check (status in ('queued', 'preparing', 'ready')),
  add constraint production_items_check
    check ((status = 'queued') = (started_at is null and ready_at is null)),
  add constraint production_items_check1
    check (status <> 'ready' or (started_at is not null and ready_at is not null));

commit;
