begin;

alter table private.business_media_assets
drop constraint business_media_assets_kind_check;

alter table private.business_media_assets
add constraint business_media_assets_kind_check
check (kind in ('cover', 'logo', 'product', 'reference'));

create or replace function private.reserve_business_media_asset(
  target_tenant_id uuid,
  target_location_id uuid,
  target_requester_id uuid,
  target_kind text,
  target_content_type text,
  target_source_size_bytes bigint
)
returns private.business_media_assets
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  asset_id uuid := gen_random_uuid();
  current_usage bigint;
  extension text;
  reserved_asset private.business_media_assets%rowtype;
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

  if target_kind not in ('cover', 'logo', 'product', 'reference') then
    raise exception 'unsupported business media kind' using errcode = '22023';
  end if;
  extension := case target_content_type
    when 'image/jpeg' then 'jpg'
    when 'image/png' then 'png'
    when 'image/webp' then 'webp'
    else null
  end;
  if extension is null then
    raise exception 'unsupported business media type' using errcode = '22023';
  end if;
  if target_source_size_bytes < 1 or target_source_size_bytes > 12582912 then
    raise exception 'business media source exceeds file limit'
      using errcode = '22023';
  end if;

  perform 1
  from public.tenants tenant
  where tenant.id = target_tenant_id
  for update;

  select coalesce(sum(asset.source_size_bytes), 0)
  into current_usage
  from private.business_media_assets asset
  where asset.tenant_id = target_tenant_id
    and (
      asset.status = 'ready'
      or (
        asset.status = 'reserved'
        and asset.reservation_expires_at > statement_timestamp()
      )
    );

  if current_usage + target_source_size_bytes > 1073741824 then
    raise exception 'business media tenant quota exceeded'
      using errcode = '22023';
  end if;

  insert into private.business_media_assets (
    id,
    tenant_id,
    location_id,
    kind,
    content_type,
    source_size_bytes,
    object_path,
    created_by
  ) values (
    asset_id,
    target_tenant_id,
    target_location_id,
    target_kind,
    target_content_type,
    target_source_size_bytes,
    'tenants/' || target_tenant_id::text
      || '/locations/' || target_location_id::text
      || '/business-profile/' || target_kind || '/' || asset_id::text
      || '.' || extension,
    target_requester_id
  )
  returning * into reserved_asset;

  return reserved_asset;
end;
$$;

create function private.validate_catalog_product_media()
returns trigger
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
begin
  if exists (
    select 1
    from jsonb_array_elements(new.snapshot -> 'products') product
    where product -> 'imageAssetId' is distinct from 'null'::jsonb
      and not exists (
        select 1
        from private.business_media_assets asset
        where asset.id = (product ->> 'imageAssetId')::uuid
          and asset.tenant_id = new.tenant_id
          and asset.location_id = new.location_id
          and asset.kind = 'product'
          and asset.status = 'ready'
      )
  ) then
    raise exception 'catalog product images must be ready, tenant-scoped, location-scoped, and product media'
      using errcode = '22023';
  end if;

  return new;
end;
$$;

revoke all on function private.validate_catalog_product_media()
from public, anon, authenticated, authenticator;

create trigger validate_catalog_product_media_before_write
before insert or update on private.catalog_drafts
for each row execute function private.validate_catalog_product_media();

commit;
