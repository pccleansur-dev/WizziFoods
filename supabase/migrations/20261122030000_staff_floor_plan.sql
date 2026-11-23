begin;

create or replace function private.require_staff_floor_plan_manager(
  target_tenant_id uuid, target_location_id uuid, target_staff_id uuid
)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.staff_members staff
    join public.tenants tenant on tenant.id = staff.tenant_id
    where staff.tenant_id = target_tenant_id
      and staff.location_id = target_location_id
      and staff.id = target_staff_id
      and staff.role = 'manager'
      and staff.is_active
      and tenant.status = 'active'
  ) then
    raise exception 'staff cannot manage this floor plan' using errcode = 'PT200';
  end if;
end;
$$;

revoke all on function private.require_staff_floor_plan_manager(uuid, uuid, uuid)
from public, anon, authenticated, authenticator;

-- Keep both roles on the same implementation of versioning, physical table
-- identity, command replay and active-group protection.
do $migration$
declare
  definition text;
  original_definition text;
  signature text := 'private.save_floor_plan(target_tenant_id uuid, target_location_id uuid, target_requester_id uuid, target_command_id uuid, target_expected_version integer, target_plan jsonb)';
  gate text := $old$  perform private.require_floor_plan_admin(
    target_tenant_id,
    target_location_id,
    target_requester_id
  );$old$;
  actor text := $$    'tenant_admin',
    target_requester_id,
    'floor_plan.saved',$$;
  retire text := '  -- Tables absent from the plan are retired: their QR stops resolving.';
begin
  if to_regprocedure('private.write_floor_plan(uuid,uuid,uuid,uuid,integer,jsonb,boolean)') is not null then
    return;
  end if;
  definition := replace(pg_get_functiondef('private.save_floor_plan(uuid,uuid,uuid,uuid,integer,jsonb)'::regprocedure), chr(13), '');
  original_definition := definition;
  gate := replace(gate, chr(13), '');
  actor := replace(actor, chr(13), '');
  if strpos(definition, signature) = 0 or strpos(definition, gate) = 0
    or strpos(definition, actor) = 0 or strpos(definition, retire) = 0
    or strpos(definition, 'updated_by = target_requester_id,') = 0 then
    raise exception 'save_floor_plan changed: expected anchors not found';
  end if;
  definition := replace(definition, signature,
    'private.write_floor_plan(target_tenant_id uuid, target_location_id uuid, target_requester_id uuid, target_command_id uuid, target_expected_version integer, target_plan jsonb, staff_actor boolean)');
  definition := replace(definition, gate, $new$  if staff_actor then
    perform private.require_staff_floor_plan_manager(target_tenant_id, target_location_id, target_requester_id);
  else
    perform private.require_floor_plan_admin(target_tenant_id, target_location_id, target_requester_id);
  end if;
  perform pg_advisory_xact_lock(private.table_groups_lock_key(target_tenant_id, target_location_id));$new$);
  definition := replace(definition, 'updated_by = target_requester_id,',
    'updated_by = case when staff_actor then null else target_requester_id end,');
  definition := replace(definition, actor, $$    case when staff_actor then 'staff' else 'tenant_admin' end,
    target_requester_id,
    'floor_plan.saved',$$);
  definition := replace(definition, retire, $new$  if staff_actor and exists (
    select 1 from private.floor_tables existing
    left join private.floor_group_members member
      on member.tenant_id = existing.tenant_id and member.location_id = existing.location_id
      and member.table_id = existing.id
    join private.table_sessions active
      on active.tenant_id = existing.tenant_id and active.location_id = existing.location_id
      and active.scope_key = coalesce(member.group_id, existing.id) and active.status = 'open'
    where existing.tenant_id = target_tenant_id and existing.location_id = target_location_id
      and existing.retired_at is null
      and not exists (
        select 1 from jsonb_array_elements(target_plan -> 'tables') proposed_table(item)
        where (proposed_table.item ->> 'id')::uuid = existing.id
      )
  ) then
    raise exception 'staff cannot retire a table with an open account' using errcode = 'PT281';
  end if;

  -- Tables absent from the plan are retired: their QR stops resolving.$new$);
  execute definition;
  execute format(
    'comment on function private.write_floor_plan(uuid,uuid,uuid,uuid,integer,jsonb,boolean) is %L',
    original_definition
  );
end;
$migration$;

revoke all on function private.write_floor_plan(uuid, uuid, uuid, uuid, integer, jsonb, boolean)
from public, anon, authenticated, authenticator;

do $permissions$
declare
  admin_function_owner name;
begin
  select pg_get_userbyid(proowner) into strict admin_function_owner
  from pg_proc
  where oid = 'private.save_floor_plan(uuid,uuid,uuid,uuid,integer,jsonb)'::regprocedure;
  execute format(
    'grant execute on function private.write_floor_plan(uuid,uuid,uuid,uuid,integer,jsonb,boolean) to %I',
    admin_function_owner
  );
end;
$permissions$;

create or replace function private.save_floor_plan(
  target_tenant_id uuid, target_location_id uuid, target_requester_id uuid,
  target_command_id uuid, target_expected_version integer, target_plan jsonb
)
returns table (applied boolean, result jsonb)
language sql
security definer
set search_path = ''
set row_security = off
as $$
  select * from private.write_floor_plan(
    target_tenant_id, target_location_id, target_requester_id,
    target_command_id, target_expected_version, target_plan, false
  );
$$;

create function private.save_staff_floor_plan(
  target_tenant_id uuid, target_location_id uuid, target_staff_id uuid,
  target_command_id uuid, expected_version integer, target_plan jsonb
)
returns table (applied boolean, result jsonb)
language sql
security definer
set search_path = ''
set row_security = off
as $$
  select * from private.write_floor_plan(
    target_tenant_id, target_location_id, target_staff_id,
    target_command_id, expected_version, target_plan, true
  );
$$;

create function private.get_staff_floor_plan(
  target_tenant_id uuid, target_location_id uuid, target_staff_id uuid
)
returns table (result jsonb, hostname text, codes jsonb)
language plpgsql
stable
security definer
set search_path = ''
set row_security = off
as $$
begin
  perform private.require_staff_floor_plan_manager(target_tenant_id, target_location_id, target_staff_id);
  return query select
    private.read_floor_plan(target_tenant_id, target_location_id),
    (select domain.hostname from public.tenant_domains domain
     join public.locations location on location.tenant_id = domain.tenant_id
       and location.id = target_location_id and location.is_primary
     where domain.tenant_id = target_tenant_id and domain.status = 'active'
     order by domain.is_primary desc, domain.hostname limit 1),
    coalesce((
      select jsonb_agg(jsonb_build_object('tableId', floor_table.id, 'label', floor_table.label, 'token', qr.token)
        order by floor_table.position, floor_table.id)
      from private.floor_tables floor_table
      join private.floor_table_qr_codes qr
        on qr.tenant_id = floor_table.tenant_id and qr.location_id = floor_table.location_id
        and qr.table_id = floor_table.id and qr.status = 'active'
      where floor_table.tenant_id = target_tenant_id
        and floor_table.location_id = target_location_id and floor_table.retired_at is null
    ), '[]'::jsonb);
end;
$$;

revoke all on function private.get_staff_floor_plan(uuid, uuid, uuid),
  private.save_staff_floor_plan(uuid, uuid, uuid, uuid, integer, jsonb)
from public, anon, authenticated;
grant execute on function private.get_staff_floor_plan(uuid, uuid, uuid),
  private.save_staff_floor_plan(uuid, uuid, uuid, uuid, integer, jsonb)
to authenticator;

commit;
