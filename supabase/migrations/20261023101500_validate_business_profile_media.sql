begin;

create function private.validate_business_profile_media()
returns trigger
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
begin
  if new.logo_asset_id is not null and not exists (
    select 1
    from private.business_media_assets asset
    where asset.id = new.logo_asset_id
      and asset.tenant_id = new.tenant_id
      and asset.location_id = new.location_id
      and asset.kind = 'logo'
      and asset.status = 'ready'
  ) then
    raise exception 'business profile media must be ready, tenant-scoped, location-scoped, and match its assigned kind'
      using errcode = '22023';
  end if;

  if new.cover_asset_id is not null and not exists (
    select 1
    from private.business_media_assets asset
    where asset.id = new.cover_asset_id
      and asset.tenant_id = new.tenant_id
      and asset.location_id = new.location_id
      and asset.kind = 'cover'
      and asset.status = 'ready'
  ) then
    raise exception 'business profile media must be ready, tenant-scoped, location-scoped, and match its assigned kind'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from unnest(new.reference_asset_ids) as reference(asset_id)
    where not exists (
      select 1
      from private.business_media_assets asset
      where asset.id = reference.asset_id
        and asset.tenant_id = new.tenant_id
        and asset.location_id = new.location_id
        and asset.kind = 'reference'
        and asset.status = 'ready'
    )
  ) then
    raise exception 'business profile media must be ready, tenant-scoped, location-scoped, and match its assigned kind'
      using errcode = '22023';
  end if;

  return new;
end;
$$;

revoke all on function private.validate_business_profile_media()
from public, anon, authenticated, authenticator;

create trigger validate_business_profile_media_before_write
before insert or update on private.business_profile_drafts
for each row execute function private.validate_business_profile_media();

commit;
