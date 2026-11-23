begin;

-- Restore the original admin entry point. Keep saved plans, QR codes and audit events.
drop function private.get_staff_floor_plan(uuid, uuid, uuid);
drop function private.save_staff_floor_plan(uuid, uuid, uuid, uuid, integer, jsonb);

do $rollback$
declare
  original_definition text := obj_description(
    'private.write_floor_plan(uuid,uuid,uuid,uuid,integer,jsonb,boolean)'::regprocedure,
    'pg_proc'
  );
begin
  if original_definition is null then
    raise exception 'original save_floor_plan definition not found';
  end if;
  execute original_definition;
end;
$rollback$;

drop function private.write_floor_plan(uuid, uuid, uuid, uuid, integer, jsonb, boolean);
drop function private.require_staff_floor_plan_manager(uuid, uuid, uuid);

commit;
