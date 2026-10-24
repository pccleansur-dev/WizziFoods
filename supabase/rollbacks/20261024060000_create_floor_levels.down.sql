begin;

-- Restores the single-floor functions of T13. Floors are discarded.
create or replace function private.floor_plan_is_valid(target_plan jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  item jsonb;
  member jsonb;
begin
  if not private.floor_keys_are(target_plan, array['groups', 'sectors', 'tables'])
    or jsonb_typeof(target_plan -> 'sectors') <> 'array'
    or jsonb_typeof(target_plan -> 'tables') <> 'array'
    or jsonb_typeof(target_plan -> 'groups') <> 'array'
    or jsonb_array_length(target_plan -> 'sectors') > 20
    or jsonb_array_length(target_plan -> 'tables') > 200
    or jsonb_array_length(target_plan -> 'groups') > 50
  then
    return false;
  end if;

  for item in select value from jsonb_array_elements(target_plan -> 'sectors') loop
    if not private.floor_keys_are(item, array['id', 'name', 'position'])
      or not private.floor_is_uuid(item -> 'id')
      or jsonb_typeof(item -> 'name') <> 'string'
      or not private.floor_is_integer(item -> 'position')
    then
      return false;
    end if;
  end loop;

  for item in select value from jsonb_array_elements(target_plan -> 'tables') loop
    if not private.floor_keys_are(item, array[
        'height', 'id', 'label', 'rotation', 'seatCount', 'seatLayout',
        'sectorId', 'shape', 'width', 'x', 'y'
      ])
      or not private.floor_is_uuid(item -> 'id')
      or not private.floor_is_uuid(item -> 'sectorId')
      or jsonb_typeof(item -> 'label') <> 'string'
      or jsonb_typeof(item -> 'shape') <> 'string'
      or jsonb_typeof(item -> 'seatLayout') <> 'string'
      or not private.floor_is_integer(item -> 'x')
      or not private.floor_is_integer(item -> 'y')
      or not private.floor_is_integer(item -> 'width')
      or not private.floor_is_integer(item -> 'height')
      or not private.floor_is_integer(item -> 'rotation')
      or not private.floor_is_integer(item -> 'seatCount')
    then
      return false;
    end if;
  end loop;

  for item in select value from jsonb_array_elements(target_plan -> 'groups') loop
    if not private.floor_keys_are(item, array['id', 'name', 'tableIds'])
      or not private.floor_is_uuid(item -> 'id')
      or jsonb_typeof(item -> 'name') <> 'string'
      or jsonb_typeof(item -> 'tableIds') <> 'array'
      or jsonb_array_length(item -> 'tableIds') not between 2 and 20
    then
      return false;
    end if;
    for member in select value from jsonb_array_elements(item -> 'tableIds') loop
      if not private.floor_is_uuid(member) then
        return false;
      end if;
    end loop;
  end loop;

  return true;
end;
$$;

create or replace function private.read_floor_plan(
  target_tenant_id uuid,
  target_location_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select jsonb_build_object(
    'version', coalesce((
      select plan.version
      from private.floor_plans plan
      where plan.tenant_id = target_tenant_id
        and plan.location_id = target_location_id
    ), 0),
    'plan', jsonb_build_object(
      'sectors', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', sector.id,
            'name', sector.name,
            'position', sector.position
          ) order by sector.position, sector.id
        )
        from private.floor_sectors sector
        where sector.tenant_id = target_tenant_id
          and sector.location_id = target_location_id
      ), '[]'::jsonb),
      'tables', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'height', geometry.height,
            'id', floor_table.id,
            'label', floor_table.label,
            'rotation', geometry.rotation,
            'seatCount', geometry.seat_count,
            'seatLayout', geometry.seat_layout,
            'sectorId', floor_table.sector_id,
            'shape', geometry.shape,
            'width', geometry.width,
            'x', geometry.x,
            'y', geometry.y
          ) order by floor_table.position, floor_table.id
        )
        from private.floor_tables floor_table
        join private.floor_table_geometry geometry
          on geometry.tenant_id = floor_table.tenant_id
          and geometry.location_id = floor_table.location_id
          and geometry.table_id = floor_table.id
        where floor_table.tenant_id = target_tenant_id
          and floor_table.location_id = target_location_id
          and floor_table.retired_at is null
      ), '[]'::jsonb),
      'groups', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', floor_group.id,
            'name', floor_group.name,
            'tableIds', (
              select jsonb_agg(member.table_id order by member.position, member.table_id)
              from private.floor_group_members member
              where member.tenant_id = floor_group.tenant_id
                and member.location_id = floor_group.location_id
                and member.group_id = floor_group.id
            )
          ) order by floor_group.position, floor_group.id
        )
        from private.floor_groups floor_group
        where floor_group.tenant_id = target_tenant_id
          and floor_group.location_id = target_location_id
      ), '[]'::jsonb)
    )
  );
$$;

create or replace function private.save_floor_plan(
  target_tenant_id uuid,
  target_location_id uuid,
  target_requester_id uuid,
  target_command_id uuid,
  target_expected_version integer,
  target_plan jsonb
)
returns table (applied boolean, result jsonb)
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  current_plan private.floor_plans%rowtype;
  existing_command private.floor_plan_commands%rowtype;
  computed_hash text;
  new_version integer;
  incoming record;
begin
  perform private.require_floor_plan_admin(
    target_tenant_id,
    target_location_id,
    target_requester_id
  );

  if target_command_id is null
    or target_expected_version is null
    or target_expected_version < 0
    or not private.floor_plan_is_valid(target_plan)
  then
    raise exception 'invalid floor plan command' using errcode = '22023';
  end if;

  computed_hash := encode(
    sha256(convert_to(
      target_expected_version::text || ':' || target_plan::text,
      'UTF8'
    )),
    'hex'
  );

  insert into private.floor_plans (tenant_id, location_id, version)
  values (target_tenant_id, target_location_id, 0)
  on conflict (tenant_id, location_id) do nothing;

  select * into current_plan
  from private.floor_plans plan
  where plan.tenant_id = target_tenant_id
    and plan.location_id = target_location_id
  for update;

  select * into existing_command
  from private.floor_plan_commands command
  where command.tenant_id = target_tenant_id
    and command.location_id = target_location_id
    and command.command_id = target_command_id;

  if found then
    if existing_command.request_hash <> computed_hash then
      raise exception 'command id already used with another payload'
        using errcode = '23505';
    end if;
    return query select false, private.read_floor_plan(
      target_tenant_id,
      target_location_id
    );
    return;
  end if;

  if current_plan.version <> target_expected_version then
    raise exception 'floor plan version changed' using errcode = '40001';
  end if;

  set constraints private.floor_tables_label_unique deferred;

  -- Sectors: upsert now, delete the missing ones after tables moved away.
  insert into private.floor_sectors (tenant_id, location_id, id, name, position)
  select
    target_tenant_id,
    target_location_id,
    (sector ->> 'id')::uuid,
    sector ->> 'name',
    (sector ->> 'position')::integer
  from jsonb_array_elements(target_plan -> 'sectors') sector
  on conflict (tenant_id, location_id, id) do update
  set name = excluded.name, position = excluded.position;

  if exists (
    select 1
    from jsonb_array_elements(target_plan -> 'tables') incoming_table
    join private.floor_tables existing
      on existing.tenant_id = target_tenant_id
      and existing.location_id = target_location_id
      and existing.id = (incoming_table ->> 'id')::uuid
    where existing.retired_at is not null
  ) then
    raise exception 'a retired table cannot be restored' using errcode = '23505';
  end if;

  -- Tables: identity rows are only inserted once; later saves update label,
  -- sector and ordering and never replace the row or its QR.
  for incoming in
    select value as item, ordinality - 1 as ordinal
    from jsonb_array_elements(target_plan -> 'tables') with ordinality
  loop
    insert into private.floor_tables (
      tenant_id, location_id, id, sector_id, label, position
    ) values (
      target_tenant_id,
      target_location_id,
      (incoming.item ->> 'id')::uuid,
      (incoming.item ->> 'sectorId')::uuid,
      incoming.item ->> 'label',
      incoming.ordinal
    )
    on conflict (tenant_id, location_id, id) do update
    set sector_id = excluded.sector_id,
        label = excluded.label,
        position = excluded.position;

    insert into private.floor_table_geometry (
      tenant_id, location_id, table_id, shape, x, y, width, height,
      rotation, seat_count, seat_layout
    ) values (
      target_tenant_id,
      target_location_id,
      (incoming.item ->> 'id')::uuid,
      incoming.item ->> 'shape',
      (incoming.item ->> 'x')::integer,
      (incoming.item ->> 'y')::integer,
      (incoming.item ->> 'width')::integer,
      (incoming.item ->> 'height')::integer,
      (incoming.item ->> 'rotation')::integer,
      (incoming.item ->> 'seatCount')::integer,
      incoming.item ->> 'seatLayout'
    )
    on conflict (tenant_id, location_id, table_id) do update
    set shape = excluded.shape,
        x = excluded.x,
        y = excluded.y,
        width = excluded.width,
        height = excluded.height,
        rotation = excluded.rotation,
        seat_count = excluded.seat_count,
        seat_layout = excluded.seat_layout,
        updated_at = statement_timestamp();

    insert into private.floor_table_qr_codes (
      tenant_id, location_id, table_id, token
    )
    select
      target_tenant_id,
      target_location_id,
      (incoming.item ->> 'id')::uuid,
      private.floor_new_qr_token()
    where not exists (
      select 1
      from private.floor_table_qr_codes qr
      where qr.tenant_id = target_tenant_id
        and qr.location_id = target_location_id
        and qr.table_id = (incoming.item ->> 'id')::uuid
        and qr.status = 'active'
    );
  end loop;

  -- Tables absent from the plan are retired: their QR stops resolving.
  update private.floor_table_qr_codes qr
  set status = 'revoked',
      revoked_at = statement_timestamp(),
      revoked_reason = 'table_retired'
  where qr.tenant_id = target_tenant_id
    and qr.location_id = target_location_id
    and qr.status = 'active'
    and qr.table_id in (
      select floor_table.id
      from private.floor_tables floor_table
      where floor_table.tenant_id = target_tenant_id
        and floor_table.location_id = target_location_id
        and floor_table.retired_at is null
        and floor_table.id not in (
          select (t ->> 'id')::uuid
          from jsonb_array_elements(target_plan -> 'tables') t
        )
    );

  update private.floor_tables floor_table
  set retired_at = statement_timestamp(), sector_id = null
  where floor_table.tenant_id = target_tenant_id
    and floor_table.location_id = target_location_id
    and floor_table.retired_at is null
    and floor_table.id not in (
      select (t ->> 'id')::uuid
      from jsonb_array_elements(target_plan -> 'tables') t
    );

  delete from private.floor_sectors sector
  where sector.tenant_id = target_tenant_id
    and sector.location_id = target_location_id
    and sector.id not in (
      select (s ->> 'id')::uuid
      from jsonb_array_elements(target_plan -> 'sectors') s
    );

  -- Groups are temporary membership: replaced without touching tables.
  delete from private.floor_group_members member
  where member.tenant_id = target_tenant_id
    and member.location_id = target_location_id;

  delete from private.floor_groups floor_group
  where floor_group.tenant_id = target_tenant_id
    and floor_group.location_id = target_location_id
    and floor_group.id not in (
      select (g ->> 'id')::uuid
      from jsonb_array_elements(target_plan -> 'groups') g
    );

  for incoming in
    select value as item, ordinality - 1 as ordinal
    from jsonb_array_elements(target_plan -> 'groups') with ordinality
  loop
    insert into private.floor_groups (
      tenant_id, location_id, id, name, position
    ) values (
      target_tenant_id,
      target_location_id,
      (incoming.item ->> 'id')::uuid,
      incoming.item ->> 'name',
      incoming.ordinal
    )
    on conflict (tenant_id, location_id, id) do update
    set name = excluded.name, position = excluded.position;

    insert into private.floor_group_members (
      tenant_id, location_id, group_id, table_id, position
    )
    select
      target_tenant_id,
      target_location_id,
      (incoming.item ->> 'id')::uuid,
      (member.value #>> '{}')::uuid,
      member.ordinality - 1
    from jsonb_array_elements(incoming.item -> 'tableIds')
      with ordinality as member(value, ordinality);
  end loop;

  set constraints private.floor_tables_label_unique immediate;

  new_version := current_plan.version + 1;
  update private.floor_plans plan
  set version = new_version,
      updated_by = target_requester_id,
      updated_at = statement_timestamp()
  where plan.tenant_id = target_tenant_id
    and plan.location_id = target_location_id;

  insert into private.floor_plan_commands (
    tenant_id, location_id, command_id, request_hash, resulting_version
  ) values (
    target_tenant_id,
    target_location_id,
    target_command_id,
    computed_hash,
    new_version
  );

  perform private.append_audit_event(
    target_tenant_id,
    'tenant_admin',
    target_requester_id,
    'floor_plan.saved',
    'Plano del salón guardado',
    target_command_id::text,
    'location',
    target_location_id
  );

  return query select true, private.read_floor_plan(
    target_tenant_id,
    target_location_id
  );
end;
$$;

alter table private.floor_tables
  drop constraint if exists floor_tables_level_required,
  drop constraint if exists floor_tables_level_fkey,
  drop column if exists level_id;

drop table if exists private.floor_levels;

commit;
