begin;
drop trigger if exists guard_order_service_hours on private.order_intent_items;
drop function if exists private.guard_order_service_hours();
drop function if exists private.order_hours_status(uuid,uuid,timestamptz);
drop function if exists private.admin_order_hours(uuid,uuid,uuid,jsonb);
drop table if exists private.order_service_hours;
commit;
