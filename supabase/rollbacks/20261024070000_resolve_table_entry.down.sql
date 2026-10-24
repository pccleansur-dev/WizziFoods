begin;

drop function if exists private.resolve_table_entry(uuid, uuid, text);
drop table if exists private.floor_table_service_states;

commit;
