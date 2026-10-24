begin;

-- A table that belongs to a group keeps its own QR, but the QR also tells which
-- group it belongs to so the group can be treated as a single party later.
drop function if exists private.resolve_floor_table_qr(uuid, uuid, text);

create function private.resolve_floor_table_qr(
  target_tenant_id uuid,
  target_location_id uuid,
  target_token text
)
returns table (
  table_id uuid,
  label text,
  sector_name text,
  group_id uuid,
  group_name text,
  group_table_labels text[]
)
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select
    floor_table.id,
    floor_table.label,
    sector.name,
    floor_group.id,
    floor_group.name,
    case when floor_group.id is null then null else (
      select array_agg(mate.label order by mate.label)
      from private.floor_group_members mate_member
      join private.floor_tables mate
        on mate.tenant_id = mate_member.tenant_id
        and mate.location_id = mate_member.location_id
        and mate.id = mate_member.table_id
      where mate_member.tenant_id = floor_group.tenant_id
        and mate_member.location_id = floor_group.location_id
        and mate_member.group_id = floor_group.id
        and mate.retired_at is null
    ) end
  from private.floor_table_qr_codes qr
  join private.floor_tables floor_table
    on floor_table.tenant_id = qr.tenant_id
    and floor_table.location_id = qr.location_id
    and floor_table.id = qr.table_id
  join private.floor_sectors sector
    on sector.tenant_id = floor_table.tenant_id
    and sector.location_id = floor_table.location_id
    and sector.id = floor_table.sector_id
  left join private.floor_group_members member
    on member.tenant_id = floor_table.tenant_id
    and member.location_id = floor_table.location_id
    and member.table_id = floor_table.id
  left join private.floor_groups floor_group
    on floor_group.tenant_id = member.tenant_id
    and floor_group.location_id = member.location_id
    and floor_group.id = member.group_id
  where qr.token = target_token
    and qr.status = 'active'
    and qr.tenant_id = target_tenant_id
    and qr.location_id = target_location_id
    and floor_table.retired_at is null;
$$;

revoke all on function private.resolve_floor_table_qr(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function private.resolve_floor_table_qr(uuid, uuid, text)
  to authenticator;

commit;
