begin;

drop function if exists private.floor_plan_readiness(uuid, uuid);
drop function if exists private.rotate_floor_table_qr(uuid, uuid, uuid, uuid);
drop function if exists private.resolve_floor_table_qr(uuid, uuid, text);
drop function if exists private.list_floor_table_qr_codes(uuid, uuid, uuid);
drop function if exists private.save_floor_plan(
  uuid, uuid, uuid, uuid, integer, jsonb
);
drop function if exists private.get_floor_plan(uuid, uuid, uuid);
drop function if exists private.read_floor_plan(uuid, uuid);
drop function if exists private.floor_plan_is_valid(jsonb);
drop function if exists private.floor_is_integer(jsonb);
drop function if exists private.floor_is_uuid(jsonb);
drop function if exists private.floor_keys_are(jsonb, text[]);
drop function if exists private.floor_new_qr_token();
drop function if exists private.require_floor_plan_admin(uuid, uuid, uuid);

drop table if exists private.floor_plan_commands;
drop table if exists private.floor_table_qr_codes;
drop table if exists private.floor_group_members;
drop table if exists private.floor_groups;
drop table if exists private.floor_table_geometry;
drop table if exists private.floor_tables;
drop table if exists private.floor_sectors;
drop table if exists private.floor_plans;

drop function if exists private.floor_protect_identity();

commit;
