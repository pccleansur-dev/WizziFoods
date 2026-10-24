begin;

drop function if exists private.create_order_intent(uuid, uuid, text, uuid, text, text, text, text, text, jsonb);
drop function if exists private.list_public_payment_methods(uuid, uuid);
drop table if exists private.waiter_calls;
drop table if exists private.product_operational_stock;
drop table if exists private.order_intent_items;
drop table if exists private.order_intents;
drop table if exists private.order_intent_commands;

commit;
