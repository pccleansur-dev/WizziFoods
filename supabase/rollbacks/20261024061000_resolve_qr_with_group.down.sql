begin;

-- Back to the T13 shape: the QR resolves to its table only.
drop function if exists private.resolve_floor_table_qr(uuid, uuid, text);

create function private.resolve_floor_table_qr(
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

revoke all on function private.resolve_floor_table_qr(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function private.resolve_floor_table_qr(uuid, uuid, text)
  to authenticator;

commit;
