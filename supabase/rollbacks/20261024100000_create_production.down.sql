begin;

drop trigger if exists confirmed_order_items_enqueue_production on private.confirmed_order_items;
drop function if exists private.advance_production_item(uuid, uuid, uuid, uuid, uuid, uuid, text);
drop function if exists private.production_board(uuid, uuid, uuid);
drop function if exists private.production_status_of(text[]);
drop function if exists private.production_actor_kind(uuid, uuid, uuid);
drop function if exists private.enqueue_production_item();
drop function if exists private.production_sector_kind(uuid, uuid, integer, uuid);

-- Item states and their history are operational records: dropping them is
-- destructive and only meant for a database that never operated for real.
drop table if exists private.production_item_events;
drop table if exists private.production_items;
drop function if exists private.guard_production_item_change();

commit;
