begin;

-- Floors (plantas): a location can have several. A table belongs to one floor and
-- to one sector (the sector is a service zone, not a physical level). Moving a
-- table to another floor never changes its id or its QR.

create table private.floor_levels (
  tenant_id uuid not null,
  location_id uuid not null,
  id uuid not null,
  name text not null check (
    name = btrim(name)
    and char_length(name) between 1 and 60
    and name !~ '[[:cntrl:]]'
  ),
  short_name text check (
    short_name is null
    or (
      short_name = btrim(short_name)
      and char_length(short_name) between 1 and 10
      and short_name !~ '[[:cntrl:]]'
    )
  ),
  position integer not null check (position between 0 and 100),
  created_at timestamptz not null default now(),
  primary key (tenant_id, location_id, id),
  foreign key (tenant_id, location_id)
    references private.floor_plans(tenant_id, location_id)
    on delete cascade,
  constraint floor_levels_name_unique
    exclude using btree (
      tenant_id with =,
      location_id with =,
      lower(name) with =
    ) deferrable initially immediate
);

revoke all on table private.floor_levels
from public, anon, authenticated, authenticator;

-- Existing plans keep working: everything they have lands on «Planta baja».
insert into private.floor_levels (tenant_id, location_id, id, name, position)
select plan.tenant_id, plan.location_id, gen_random_uuid(), 'Planta baja', 0
from private.floor_plans plan;

alter table private.floor_tables add column level_id uuid;

update private.floor_tables floor_table
set level_id = level.id
from private.floor_levels level
where level.tenant_id = floor_table.tenant_id
  and level.location_id = floor_table.location_id
  and floor_table.retired_at is null;

alter table private.floor_tables
  add constraint floor_tables_level_fkey
    foreign key (tenant_id, location_id, level_id)
    references private.floor_levels(tenant_id, location_id, id)
    on delete restrict,
  add constraint floor_tables_level_required
    check ((retired_at is null) = (level_id is not null));

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
  if not private.floor_keys_are(target_plan, array['floors', 'groups', 'sectors', 'tables'])
    or jsonb_typeof(target_plan -> 'floors') <> 'array'
    or jsonb_array_length(target_plan -> 'floors') > 10
    or jsonb_typeof(target_plan -> 'sectors') <> 'array'
    or jsonb_typeof(target_plan -> 'tables') <> 'array'
    or jsonb_typeof(target_plan -> 'groups') <> 'array'
    or jsonb_array_length(target_plan -> 'sectors') > 20
    or jsonb_array_length(target_plan -> 'tables') > 200
    or jsonb_array_length(target_plan -> 'groups') > 50
  then
    return false;
  end if;

  for item in select value from jsonb_array_elements(target_plan -> 'floors') loop
    if not private.floor_keys_are(item, array['id', 'name', 'position', 'shortName'])
      or not private.floor_is_uuid(item -> 'id')
      or jsonb_typeof(item -> 'name') <> 'string'
      or jsonb_typeof(item -> 'shortName') not in ('string', 'null')
      or not private.floor_is_integer(item -> 'position')
    then
      return false;
    end if;
  end loop;

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
        'floorId', 'height', 'id', 'label', 'rotation', 'seatCount',
        'seatLayout', 'sectorId', 'shape', 'width', 'x', 'y'
      ])
      or not private.floor_is_uuid(item -> 'id')
      or not private.floor_is_uuid(item -> 'sectorId')
      or not private.floor_is_uuid(item -> 'floorId')
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

  -- Every table sits on a floor that exists in the same plan.
  if exists (
    select 1
    from jsonb_array_elements(target_plan -> 'tables') floor_table
    where not exists (
      select 1
      from jsonb_array_elements(target_plan -> 'floors') level
      where level ->> 'id' = floor_table ->> 'floorId'
    )
  ) then
    return false;
  end if;

  -- A group never spans two floors.
  if exists (
    select 1
    from jsonb_array_elements(target_plan -> 'groups') floor_group
    where (
      select count(distinct floor_table ->> 'floorId')
      from jsonb_array_elements(target_plan -> 'tables') floor_table
      where floor_table ->> 'id' in (
        select jsonb_array_elements_text(floor_group -> 'tableIds')
      )
    ) > 1
  ) then
    return false;
  end if;

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
      'floors', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', level.id,
            'name', level.name,
            'position', level.position,
            'shortName', level.short_name
          ) order by level.position, level.id
        )
        from private.floor_levels level
        where level.tenant_id = target_tenant_id
          and level.location_id = target_location_id
      ), '[]'::jsonb),
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
            'floorId', floor_table.level_id,
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
  set constraints private.floor_levels_name_unique deferred;

  -- Floors: upsert now, delete the missing ones after their tables moved away.
  insert into private.floor_levels (
    tenant_id, location_id, id, name, short_name, position
  )
  select
    target_tenant_id,
    target_location_id,
    (level ->> 'id')::uuid,
    level ->> 'name',
    level ->> 'shortName',
    (level ->> 'position')::integer
  from jsonb_array_elements(target_plan -> 'floors') level
  on conflict (tenant_id, location_id, id) do update
  set name = excluded.name,
      short_name = excluded.short_name,
      position = excluded.position;

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
      tenant_id, location_id, id, sector_id, level_id, label, position
    ) values (
      target_tenant_id,
      target_location_id,
      (incoming.item ->> 'id')::uuid,
      (incoming.item ->> 'sectorId')::uuid,
      (incoming.item ->> 'floorId')::uuid,
      incoming.item ->> 'label',
      incoming.ordinal
    )
    on conflict (tenant_id, location_id, id) do update
    set sector_id = excluded.sector_id,
        level_id = excluded.level_id,
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
  set retired_at = statement_timestamp(), sector_id = null, level_id = null
  where floor_table.tenant_id = target_tenant_id
    and floor_table.location_id = target_location_id
    and floor_table.retired_at is null
    and floor_table.id not in (
      select (t ->> 'id')::uuid
      from jsonb_array_elements(target_plan -> 'tables') t
    );

  delete from private.floor_levels level
  where level.tenant_id = target_tenant_id
    and level.location_id = target_location_id
    and level.id not in (
      select (l ->> 'id')::uuid
      from jsonb_array_elements(target_plan -> 'floors') l
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
  set constraints private.floor_levels_name_unique immediate;

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

commit;
