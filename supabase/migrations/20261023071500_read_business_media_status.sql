begin;

create function private.get_business_media_asset_status(
  target_tenant_id uuid,
  target_location_id uuid,
  target_requester_id uuid,
  target_asset_id uuid
)
returns table (
  id uuid,
  status text,
  kind text
)
language plpgsql
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

  return query
  select asset.id, asset.status, asset.kind
  from private.business_media_assets asset
  where asset.tenant_id = target_tenant_id
    and asset.location_id = target_location_id
    and asset.id = target_asset_id
    and asset.status <> 'deleted';

  if not found then
    raise exception 'business media asset not found'
      using errcode = '22023';
  end if;
end;
$$;

revoke all on function private.get_business_media_asset_status(
  uuid, uuid, uuid, uuid
) from public, anon, authenticated;
grant execute on function private.get_business_media_asset_status(
  uuid, uuid, uuid, uuid
) to authenticator;

commit;
