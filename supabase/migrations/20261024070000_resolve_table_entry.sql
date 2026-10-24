begin;

-- Table service state (T16). A table without a row is available. Staff flows
-- (T19, T22, T26) will write here; T16 only reads it to decide what a diner
-- who scans the QR may do.
create table private.floor_table_service_states (
  tenant_id uuid not null,
  location_id uuid not null,
  table_id uuid not null,
  state text not null check (
    state in ('occupied', 'needs_cleaning', 'out_of_service')
  ),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, location_id, table_id),
  foreign key (tenant_id, location_id, table_id)
    references private.floor_tables(tenant_id, location_id, id)
    on delete cascade
);

revoke all on table private.floor_table_service_states
from public, anon, authenticated, authenticator;

-- What a QR scan means right now. Everything is scoped to the tenant and
-- location the host already proved. The service state of a grouped table is
-- shared: a table that cannot be used keeps its own state, otherwise any
-- occupied table of the group makes the whole group occupied.
create function private.resolve_table_entry(
  target_tenant_id uuid,
  target_location_id uuid,
  target_token text
)
returns table (
  table_id uuid,
  label text,
  sector_name text,
  floor_name text,
  group_id uuid,
  group_name text,
  group_table_labels text[],
  service_state text,
  published boolean,
  accepts_new_tables boolean
)
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select
    resolved.table_id,
    resolved.label,
    resolved.sector_name,
    level.name,
    resolved.group_id,
    resolved.group_name,
    resolved.group_table_labels,
    case
      when own.state is not null then own.state
      when resolved.group_id is not null and exists (
        select 1
        from private.floor_group_members mate
        join private.floor_table_service_states mate_state
          on mate_state.tenant_id = mate.tenant_id
          and mate_state.location_id = mate.location_id
          and mate_state.table_id = mate.table_id
        where mate.tenant_id = target_tenant_id
          and mate.location_id = target_location_id
          and mate.group_id = resolved.group_id
          and mate_state.state = 'occupied'
      ) then 'occupied'
      else 'available'
    end,
    exists (
      select 1
      from private.location_publications publication
      where publication.tenant_id = target_tenant_id
        and publication.location_id = target_location_id
    ),
    private.can_open_table_session(target_tenant_id)
  from private.resolve_floor_table_qr(
    target_tenant_id, target_location_id, target_token
  ) resolved
  join private.floor_tables floor_table
    on floor_table.tenant_id = target_tenant_id
    and floor_table.location_id = target_location_id
    and floor_table.id = resolved.table_id
  join private.floor_levels level
    on level.tenant_id = floor_table.tenant_id
    and level.location_id = floor_table.location_id
    and level.id = floor_table.level_id
  left join private.floor_table_service_states own
    on own.tenant_id = floor_table.tenant_id
    and own.location_id = floor_table.location_id
    and own.table_id = floor_table.id;
$$;

revoke all on function private.resolve_table_entry(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function private.resolve_table_entry(uuid, uuid, text)
  to authenticator;

commit;
