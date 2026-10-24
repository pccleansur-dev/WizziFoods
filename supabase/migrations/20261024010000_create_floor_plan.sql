begin;

-- Floor plan: sectors, physical tables and stable QR codes.
-- Three concerns are stored apart on purpose:
--   * identity   -> private.floor_tables (+ private.floor_table_qr_codes)
--   * geometry   -> private.floor_table_geometry
--   * grouping   -> private.floor_groups / private.floor_group_members
-- Moving, resizing or grouping a table never touches its identity or its QR.

create table private.floor_plans (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  location_id uuid not null,
  version integer not null default 0 check (version >= 0),
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, location_id),
  foreign key (tenant_id, location_id)
    references public.locations(tenant_id, id)
    on delete cascade,
  foreign key (tenant_id, updated_by)
    references public.tenant_memberships(tenant_id, user_id)
    on delete restrict
);

create table private.floor_sectors (
  tenant_id uuid not null,
  location_id uuid not null,
  id uuid not null,
  name text not null check (
    name = btrim(name)
    and char_length(name) between 1 and 60
    and name !~ '[[:cntrl:]]'
  ),
  position integer not null check (position between 0 and 200),
  created_at timestamptz not null default now(),
  primary key (tenant_id, location_id, id),
  foreign key (tenant_id, location_id)
    references private.floor_plans(tenant_id, location_id)
    on delete cascade
);

create table private.floor_tables (
  tenant_id uuid not null,
  location_id uuid not null,
  id uuid not null,
  sector_id uuid,
  label text not null check (
    label = btrim(label)
    and char_length(label) between 1 and 20
    and label !~ '[[:cntrl:]]'
  ),
  position integer not null check (position >= 0),
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  primary key (tenant_id, location_id, id),
  foreign key (tenant_id, location_id)
    references private.floor_plans(tenant_id, location_id)
    on delete cascade,
  foreign key (tenant_id, location_id, sector_id)
    references private.floor_sectors(tenant_id, location_id, id)
    on delete restrict,
  constraint floor_tables_sector_required
    check ((retired_at is null) = (sector_id is not null)),
  constraint floor_tables_label_unique
    exclude using btree (
      tenant_id with =,
      location_id with =,
      lower(label) with =
    ) where (retired_at is null) deferrable initially immediate
);

create table private.floor_table_geometry (
  tenant_id uuid not null,
  location_id uuid not null,
  table_id uuid not null,
  shape text not null check (shape in ('rectangle', 'round', 'square')),
  x integer not null check (x between 0 and 4000),
  y integer not null check (y between 0 and 3000),
  width integer not null check (width between 40 and 600),
  height integer not null check (height between 40 and 600),
  rotation integer not null check (rotation between 0 and 359),
  seat_count integer not null check (seat_count between 0 and 24),
  seat_layout text not null check (
    seat_layout in ('long-sides', 'one-side', 'perimeter')
  ),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, location_id, table_id),
  foreign key (tenant_id, location_id, table_id)
    references private.floor_tables(tenant_id, location_id, id)
    on delete cascade,
  check (x + width <= 4000 and y + height <= 3000),
  check (shape = 'rectangle' or width = height)
);

create table private.floor_groups (
  tenant_id uuid not null,
  location_id uuid not null,
  id uuid not null,
  name text not null check (
    name = btrim(name)
    and char_length(name) between 1 and 60
    and name !~ '[[:cntrl:]]'
  ),
  position integer not null check (position >= 0),
  created_at timestamptz not null default now(),
  primary key (tenant_id, location_id, id),
  foreign key (tenant_id, location_id)
    references private.floor_plans(tenant_id, location_id)
    on delete cascade
);

create table private.floor_group_members (
  tenant_id uuid not null,
  location_id uuid not null,
  group_id uuid not null,
  table_id uuid not null,
  position integer not null check (position >= 0),
  primary key (tenant_id, location_id, group_id, table_id),
  -- A physical table belongs to at most one group at a time.
  unique (tenant_id, location_id, table_id),
  foreign key (tenant_id, location_id, group_id)
    references private.floor_groups(tenant_id, location_id, id)
    on delete cascade,
  foreign key (tenant_id, location_id, table_id)
    references private.floor_tables(tenant_id, location_id, id)
    on delete cascade
);

create table private.floor_table_qr_codes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  location_id uuid not null,
  table_id uuid not null,
  token text not null unique check (token ~ '^[0-9a-f]{64}$'),
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_reason text check (
    revoked_reason is null
    or revoked_reason in ('rotated', 'table_retired')
  ),
  foreign key (tenant_id, location_id, table_id)
    references private.floor_tables(tenant_id, location_id, id)
    on delete cascade,
  check ((status = 'revoked') = (revoked_at is not null)),
  check ((status = 'revoked') = (revoked_reason is not null))
);

create unique index floor_table_qr_codes_one_active_idx
  on private.floor_table_qr_codes (tenant_id, location_id, table_id)
  where status = 'active';

create table private.floor_plan_commands (
  tenant_id uuid not null,
  location_id uuid not null,
  command_id uuid not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  resulting_version integer not null check (resulting_version > 0),
  created_at timestamptz not null default now(),
  primary key (tenant_id, location_id, command_id),
  foreign key (tenant_id, location_id)
    references private.floor_plans(tenant_id, location_id)
    on delete cascade
);

revoke all on table
  private.floor_plans,
  private.floor_sectors,
  private.floor_tables,
  private.floor_table_geometry,
  private.floor_groups,
  private.floor_group_members,
  private.floor_table_qr_codes,
  private.floor_plan_commands
from public, anon, authenticated, authenticator;

-- QR tokens and table ids are immutable once created.
create or replace function private.floor_protect_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'floor_table_qr_codes' then
    if new.id <> old.id
      or new.tenant_id <> old.tenant_id
      or new.location_id <> old.location_id
      or new.table_id <> old.table_id
      or new.token <> old.token
      or new.created_at <> old.created_at
      or old.status = 'revoked'
    then
      raise exception 'qr code identity is immutable' using errcode = '23514';
    end if;
  elsif new.id <> old.id
    or new.tenant_id <> old.tenant_id
    or new.location_id <> old.location_id
    or new.created_at <> old.created_at
    or (old.retired_at is not null and new.retired_at is distinct from old.retired_at)
  then
    raise exception 'floor table identity is immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger floor_table_qr_codes_protect_identity
before update on private.floor_table_qr_codes
for each row execute function private.floor_protect_identity();

create trigger floor_tables_protect_identity
before update on private.floor_tables
for each row execute function private.floor_protect_identity();

create or replace function private.require_floor_plan_admin(
  target_tenant_id uuid,
  target_location_id uuid,
  target_requester_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = ''
set row_security = off
as $$
begin
  if not exists (
    select 1
    from public.tenant_memberships membership
    where membership.tenant_id = target_tenant_id
      and membership.user_id = target_requester_id
      and membership.role = 'admin'
  ) then
    raise exception 'tenant administrator authorization required'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.locations location
    where location.tenant_id = target_tenant_id
      and location.id = target_location_id
  ) then
    raise exception 'location does not belong to tenant'
      using errcode = '42501';
  end if;
end;
$$;

create or replace function private.floor_new_qr_token()
returns text
language sql
volatile
set search_path = ''
as $$
  select replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
$$;

create or replace function private.floor_keys_are(
  target jsonb,
  expected text[]
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(target) = 'object'
    and coalesce(
      (select array_agg(key order by key) from jsonb_object_keys(target) key),
      array[]::text[]
    ) = (select array_agg(key order by key) from unnest(expected) key);
$$;

create or replace function private.floor_is_uuid(target jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(target) = 'string'
    and (target #>> '{}') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
$$;

create or replace function private.floor_is_integer(target jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(target) = 'number'
    and (target #>> '{}') ~ '^-?[0-9]{1,9}$';
$$;

-- Structural validation. Ranges are enforced again by table constraints.
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

create or replace function private.get_floor_plan(
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
    target_tenant_id,
    target_location_id,
    target_requester_id
  );
  return private.read_floor_plan(target_tenant_id, target_location_id);
end;
$$;

-- Applies a whole-plan command atomically. Replaying the same command id with
-- the same payload is a no-op that reports the stored outcome.
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

create or replace function private.list_floor_table_qr_codes(
  target_tenant_id uuid,
  target_location_id uuid,
  target_requester_id uuid
)
returns table (table_id uuid, label text, token text)
language plpgsql
stable
security definer
set search_path = ''
set row_security = off
as $$
begin
  perform private.require_floor_plan_admin(
    target_tenant_id,
    target_location_id,
    target_requester_id
  );
  return query
  select floor_table.id, floor_table.label, qr.token
  from private.floor_tables floor_table
  join private.floor_table_qr_codes qr
    on qr.tenant_id = floor_table.tenant_id
    and qr.location_id = floor_table.location_id
    and qr.table_id = floor_table.id
    and qr.status = 'active'
  where floor_table.tenant_id = target_tenant_id
    and floor_table.location_id = target_location_id
    and floor_table.retired_at is null
  order by floor_table.position, floor_table.id;
end;
$$;

-- Resolution is always scoped by the tenant/location the host already proved.
-- A valid token from another tenant resolves to nothing.
create or replace function private.resolve_floor_table_qr(
  target_tenant_id uuid,
  target_location_id uuid,
  target_token text
)
returns table (table_id uuid, label text, sector_name text)
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select floor_table.id, floor_table.label, sector.name
  from private.floor_table_qr_codes qr
  join private.floor_tables floor_table
    on floor_table.tenant_id = qr.tenant_id
    and floor_table.location_id = qr.location_id
    and floor_table.id = qr.table_id
  join private.floor_sectors sector
    on sector.tenant_id = floor_table.tenant_id
    and sector.location_id = floor_table.location_id
    and sector.id = floor_table.sector_id
  where qr.token = target_token
    and qr.status = 'active'
    and qr.tenant_id = target_tenant_id
    and qr.location_id = target_location_id
    and floor_table.retired_at is null;
$$;

create or replace function private.rotate_floor_table_qr(
  target_tenant_id uuid,
  target_location_id uuid,
  target_requester_id uuid,
  target_table_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
begin
  perform private.require_floor_plan_admin(
    target_tenant_id,
    target_location_id,
    target_requester_id
  );

  perform 1
  from private.floor_tables floor_table
  where floor_table.tenant_id = target_tenant_id
    and floor_table.location_id = target_location_id
    and floor_table.id = target_table_id
    and floor_table.retired_at is null
  for update;
  if not found then
    raise exception 'floor table not found' using errcode = 'P0002';
  end if;

  update private.floor_table_qr_codes qr
  set status = 'revoked',
      revoked_at = statement_timestamp(),
      revoked_reason = 'rotated'
  where qr.tenant_id = target_tenant_id
    and qr.location_id = target_location_id
    and qr.table_id = target_table_id
    and qr.status = 'active';

  insert into private.floor_table_qr_codes (
    tenant_id, location_id, table_id, token
  ) values (
    target_tenant_id,
    target_location_id,
    target_table_id,
    private.floor_new_qr_token()
  );

  perform private.append_audit_event(
    target_tenant_id,
    'tenant_admin',
    target_requester_id,
    'floor_table.qr_rotated',
    'Código QR de mesa rotado',
    gen_random_uuid()::text,
    'floor_table',
    target_table_id
  );
end;
$$;

-- Used by T15: a business needs at least one table with a valid QR.
create or replace function private.floor_plan_readiness(
  target_tenant_id uuid,
  target_location_id uuid
)
returns table (active_tables integer, tables_with_qr integer)
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select
    count(*)::integer,
    count(*) filter (where exists (
      select 1
      from private.floor_table_qr_codes qr
      where qr.tenant_id = floor_table.tenant_id
        and qr.location_id = floor_table.location_id
        and qr.table_id = floor_table.id
        and qr.status = 'active'
    ))::integer
  from private.floor_tables floor_table
  where floor_table.tenant_id = target_tenant_id
    and floor_table.location_id = target_location_id
    and floor_table.retired_at is null;
$$;

revoke all on function
  private.floor_protect_identity(),
  private.require_floor_plan_admin(uuid, uuid, uuid),
  private.floor_new_qr_token(),
  private.floor_keys_are(jsonb, text[]),
  private.floor_is_uuid(jsonb),
  private.floor_is_integer(jsonb),
  private.floor_plan_is_valid(jsonb),
  private.read_floor_plan(uuid, uuid),
  private.get_floor_plan(uuid, uuid, uuid),
  private.save_floor_plan(uuid, uuid, uuid, uuid, integer, jsonb),
  private.list_floor_table_qr_codes(uuid, uuid, uuid),
  private.resolve_floor_table_qr(uuid, uuid, text),
  private.rotate_floor_table_qr(uuid, uuid, uuid, uuid),
  private.floor_plan_readiness(uuid, uuid)
from public, anon, authenticated;

grant execute on function
  private.get_floor_plan(uuid, uuid, uuid),
  private.save_floor_plan(uuid, uuid, uuid, uuid, integer, jsonb),
  private.list_floor_table_qr_codes(uuid, uuid, uuid),
  private.resolve_floor_table_qr(uuid, uuid, text),
  private.rotate_floor_table_qr(uuid, uuid, uuid, uuid),
  private.floor_plan_readiness(uuid, uuid)
to authenticator;

commit;
