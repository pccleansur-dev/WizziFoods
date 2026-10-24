begin;

-- Team management (T14).
-- Identities, fixed roles and PIN credentials come from T06. Sector assignment
-- targets the salon sectors of T13 (private.floor_sectors) and applies to
-- waiters only. Kitchen and bar staff are bound to their production sector by
-- role (T11 sectors have kind kitchen / bar), so they need no assignment.

create table private.staff_sector_assignments (
  tenant_id uuid not null,
  location_id uuid not null,
  staff_member_id uuid not null,
  floor_sector_id uuid not null,
  assigned_at timestamptz not null default now(),
  primary key (staff_member_id, floor_sector_id),
  foreign key (tenant_id, staff_member_id)
    references public.staff_members(tenant_id, id)
    on delete cascade,
  -- Removing a sector narrows access: a waiter never gains tables by it.
  foreign key (tenant_id, location_id, floor_sector_id)
    references private.floor_sectors(tenant_id, location_id, id)
    on delete cascade
);

create index staff_sector_assignments_sector_idx
  on private.staff_sector_assignments (tenant_id, location_id, floor_sector_id);

revoke all on table private.staff_sector_assignments
from public, anon, authenticated, authenticator;

create or replace function private.staff_assignment_requires_waiter()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.staff_members member
    where member.tenant_id = new.tenant_id
      and member.id = new.staff_member_id
      and member.location_id = new.location_id
      and member.role = 'waiter'
  ) then
    raise exception 'only waiters of the location receive salon sectors'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger staff_sector_assignments_waiter_only
before insert or update on private.staff_sector_assignments
for each row execute function private.staff_assignment_requires_waiter();

create or replace function private.staff_member_view(
  target_tenant_id uuid,
  target_staff_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select jsonb_build_object(
    'id', member.id,
    'username', member.username,
    'displayName', member.display_name,
    'role', member.role,
    'isActive', member.is_active,
    'sectorIds', coalesce((
      select jsonb_agg(assignment.floor_sector_id order by assignment.floor_sector_id)
      from private.staff_sector_assignments assignment
      where assignment.staff_member_id = member.id
    ), '[]'::jsonb),
    'createdAt', member.created_at
  )
  from public.staff_members member
  where member.tenant_id = target_tenant_id
    and member.id = target_staff_id;
$$;

create or replace function private.staff_replace_sectors(
  target_tenant_id uuid,
  target_location_id uuid,
  target_staff_id uuid,
  target_role text,
  target_sector_ids uuid[]
)
returns boolean
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  desired uuid[];
  current_ids uuid[];
begin
  desired := coalesce(
    (select array_agg(distinct sector_id order by sector_id)
     from unnest(coalesce(target_sector_ids, '{}')) sector_id),
    '{}'
  );
  if cardinality(desired) > 50 then
    raise exception 'too many sectors' using errcode = '22023';
  end if;
  if cardinality(desired) > 0 and target_role <> 'waiter' then
    raise exception 'only waiters receive salon sectors' using errcode = '22023';
  end if;
  if (
    select count(*)
    from private.floor_sectors sector
    where sector.tenant_id = target_tenant_id
      and sector.location_id = target_location_id
      and sector.id = any(desired)
  ) <> cardinality(desired) then
    raise exception 'unknown salon sector' using errcode = '22023';
  end if;

  select coalesce(array_agg(floor_sector_id order by floor_sector_id), '{}')
  into current_ids
  from private.staff_sector_assignments
  where staff_member_id = target_staff_id;

  if current_ids = desired then
    return false;
  end if;

  delete from private.staff_sector_assignments
  where staff_member_id = target_staff_id
    and not (floor_sector_id = any(desired));
  insert into private.staff_sector_assignments (
    tenant_id, location_id, staff_member_id, floor_sector_id
  )
  select target_tenant_id, target_location_id, target_staff_id, sector_id
  from unnest(desired) sector_id
  on conflict do nothing;
  return true;
end;
$$;

create or replace function private.staff_revoke_sessions(
  target_tenant_id uuid,
  target_staff_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
begin
  with revoked as (
    update private.staff_sessions session
    set revoked_at = statement_timestamp()
    where session.tenant_id = target_tenant_id
      and session.staff_member_id = target_staff_id
      and session.revoked_at is null
    returning session.id
  )
  insert into private.staff_auth_events (tenant_id, staff_member_id, event_type)
  select target_tenant_id, target_staff_id, 'session_revoked' from revoked;
end;
$$;

-- Serialises changes to the active managers of a location and refuses any
-- change that would leave a location that already had one without any.
create or replace function private.staff_guard_last_manager(
  target_tenant_id uuid,
  target_location_id uuid,
  target_staff_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  remaining integer;
begin
  select count(*) into remaining
  from (
    select member.id
    from public.staff_members member
    where member.tenant_id = target_tenant_id
      and member.location_id = target_location_id
      and member.role = 'manager'
      and member.is_active
    for update
  ) managers
  where managers.id <> target_staff_id;

  if remaining = 0 then
    raise exception 'the last active manager cannot be removed'
      using errcode = 'PT001';
  end if;
end;
$$;

create or replace function private.list_staff_members(
  target_tenant_id uuid,
  target_location_id uuid,
  target_requester_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set row_security = off
as $$
begin
  perform private.require_floor_plan_admin(
    target_tenant_id, target_location_id, target_requester_id
  );
  return coalesce((
    select jsonb_agg(
      private.staff_member_view(member.tenant_id, member.id)
      order by member.created_at, member.id
    )
    from public.staff_members member
    where member.tenant_id = target_tenant_id
      and member.location_id = target_location_id
  ), '[]'::jsonb);
end;
$$;

create or replace function private.create_staff_member(
  target_tenant_id uuid,
  target_location_id uuid,
  target_requester_id uuid,
  target_username text,
  target_display_name text,
  target_role text,
  target_pin_hash text,
  target_sector_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  new_id uuid;
begin
  perform private.require_floor_plan_admin(
    target_tenant_id, target_location_id, target_requester_id
  );

  insert into public.staff_members (
    tenant_id, location_id, username, display_name, role, created_by
  ) values (
    target_tenant_id,
    target_location_id,
    target_username,
    target_display_name,
    target_role,
    target_requester_id
  )
  returning id into new_id;

  insert into private.staff_credentials (staff_member_id, pin_hash)
  values (new_id, target_pin_hash);

  perform private.staff_replace_sectors(
    target_tenant_id, target_location_id, new_id, target_role, target_sector_ids
  );

  perform private.append_audit_event(
    target_tenant_id, 'tenant_admin', target_requester_id,
    'staff.created', 'Empleado creado', gen_random_uuid()::text,
    'staff_member', new_id
  );
  return private.staff_member_view(target_tenant_id, new_id);
end;
$$;

create or replace function private.update_staff_member(
  target_tenant_id uuid,
  target_location_id uuid,
  target_requester_id uuid,
  target_staff_id uuid,
  target_display_name text,
  target_role text,
  target_sector_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  current_member public.staff_members;
  correlation text := gen_random_uuid()::text;
begin
  perform private.require_floor_plan_admin(
    target_tenant_id, target_location_id, target_requester_id
  );

  select * into current_member
  from public.staff_members member
  where member.tenant_id = target_tenant_id
    and member.location_id = target_location_id
    and member.id = target_staff_id
  for update;
  if not found then
    raise exception 'staff member not found' using errcode = 'P0002';
  end if;

  if target_role is distinct from current_member.role then
    if current_member.role = 'manager' and current_member.is_active then
      perform private.staff_guard_last_manager(
        target_tenant_id, target_location_id, target_staff_id
      );
    end if;
    update public.staff_members
    set role = target_role, updated_at = statement_timestamp()
    where id = target_staff_id;
    -- A new role means new capabilities: the member signs in again.
    perform private.staff_revoke_sessions(target_tenant_id, target_staff_id);
    perform private.append_audit_event(
      target_tenant_id, 'tenant_admin', target_requester_id,
      'staff.role_changed', 'Rol de empleado modificado', correlation,
      'staff_member', target_staff_id
    );
  end if;

  if target_display_name is distinct from current_member.display_name then
    update public.staff_members
    set display_name = target_display_name, updated_at = statement_timestamp()
    where id = target_staff_id;
    perform private.append_audit_event(
      target_tenant_id, 'tenant_admin', target_requester_id,
      'staff.renamed', 'Nombre de empleado modificado', correlation,
      'staff_member', target_staff_id
    );
  end if;

  if private.staff_replace_sectors(
    target_tenant_id, target_location_id, target_staff_id,
    target_role, target_sector_ids
  ) then
    perform private.append_audit_event(
      target_tenant_id, 'tenant_admin', target_requester_id,
      'staff.sectors_changed', 'Sectores de empleado modificados', correlation,
      'staff_member', target_staff_id
    );
  end if;

  return private.staff_member_view(target_tenant_id, target_staff_id);
end;
$$;

create or replace function private.set_staff_active(
  target_tenant_id uuid,
  target_location_id uuid,
  target_requester_id uuid,
  target_staff_id uuid,
  target_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  current_member public.staff_members;
begin
  perform private.require_floor_plan_admin(
    target_tenant_id, target_location_id, target_requester_id
  );

  select * into current_member
  from public.staff_members member
  where member.tenant_id = target_tenant_id
    and member.location_id = target_location_id
    and member.id = target_staff_id
  for update;
  if not found then
    raise exception 'staff member not found' using errcode = 'P0002';
  end if;

  if current_member.is_active is distinct from target_active then
    if not target_active and current_member.role = 'manager' then
      perform private.staff_guard_last_manager(
        target_tenant_id, target_location_id, target_staff_id
      );
    end if;
    update public.staff_members
    set is_active = target_active, updated_at = statement_timestamp()
    where id = target_staff_id;
    if not target_active then
      perform private.staff_revoke_sessions(target_tenant_id, target_staff_id);
    end if;
    perform private.append_audit_event(
      target_tenant_id, 'tenant_admin', target_requester_id,
      case when target_active then 'staff.activated' else 'staff.deactivated' end,
      case when target_active then 'Empleado reactivado' else 'Empleado desactivado' end,
      gen_random_uuid()::text, 'staff_member', target_staff_id
    );
  end if;
  return private.staff_member_view(target_tenant_id, target_staff_id);
end;
$$;

create or replace function private.reset_staff_pin(
  target_tenant_id uuid,
  target_location_id uuid,
  target_requester_id uuid,
  target_staff_id uuid,
  target_pin_hash text
)
returns void
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
begin
  perform private.require_floor_plan_admin(
    target_tenant_id, target_location_id, target_requester_id
  );
  perform 1
  from public.staff_members member
  where member.tenant_id = target_tenant_id
    and member.location_id = target_location_id
    and member.id = target_staff_id
  for update;
  if not found then
    raise exception 'staff member not found' using errcode = 'P0002';
  end if;

  update private.staff_credentials
  set pin_hash = target_pin_hash,
      failed_attempts = 0,
      locked_until = null,
      pin_changed_at = statement_timestamp(),
      updated_at = statement_timestamp()
  where staff_member_id = target_staff_id;
  perform private.staff_revoke_sessions(target_tenant_id, target_staff_id);
  perform private.append_audit_event(
    target_tenant_id, 'tenant_admin', target_requester_id,
    'staff.credential_reset', 'Credencial de empleado restablecida',
    gen_random_uuid()::text, 'staff_member', target_staff_id
  );
end;
$$;

-- Used by T15: reports whether the location has any active staff member.
create or replace function private.staff_team_summary(
  target_tenant_id uuid,
  target_location_id uuid
)
returns table (active_members integer, active_managers integer)
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select
    count(*) filter (where member.is_active)::integer,
    count(*) filter (where member.is_active and member.role = 'manager')::integer
  from public.staff_members member
  where member.tenant_id = target_tenant_id
    and member.location_id = target_location_id;
$$;

revoke all on function private.staff_assignment_requires_waiter() from public, anon, authenticated;
revoke all on function private.staff_member_view(uuid, uuid) from public, anon, authenticated;
revoke all on function private.staff_replace_sectors(uuid, uuid, uuid, text, uuid[]) from public, anon, authenticated;
revoke all on function private.staff_revoke_sessions(uuid, uuid) from public, anon, authenticated;
revoke all on function private.staff_guard_last_manager(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function private.list_staff_members(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function private.create_staff_member(uuid, uuid, uuid, text, text, text, text, uuid[]) from public, anon, authenticated;
revoke all on function private.update_staff_member(uuid, uuid, uuid, uuid, text, text, uuid[]) from public, anon, authenticated;
revoke all on function private.set_staff_active(uuid, uuid, uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function private.reset_staff_pin(uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function private.staff_team_summary(uuid, uuid) from public, anon, authenticated;

grant execute on function private.list_staff_members(uuid, uuid, uuid) to authenticator;
grant execute on function private.create_staff_member(uuid, uuid, uuid, text, text, text, text, uuid[]) to authenticator;
grant execute on function private.update_staff_member(uuid, uuid, uuid, uuid, text, text, uuid[]) to authenticator;
grant execute on function private.set_staff_active(uuid, uuid, uuid, uuid, boolean) to authenticator;
grant execute on function private.reset_staff_pin(uuid, uuid, uuid, uuid, text) to authenticator;
grant execute on function private.staff_team_summary(uuid, uuid) to authenticator;

commit;
