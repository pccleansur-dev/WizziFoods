begin;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
) values (
  'business-media',
  'business-media',
  false,
  12582912,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table private.business_media_assets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  location_id uuid not null,
  kind text not null check (kind in ('cover', 'logo', 'reference')),
  status text not null default 'reserved' check (
    status in ('reserved', 'ready', 'failed', 'deleted')
  ),
  content_type text not null check (
    content_type in ('image/jpeg', 'image/png', 'image/webp')
  ),
  source_size_bytes bigint not null check (
    source_size_bytes between 1 and 12582912
  ),
  stored_size_bytes bigint check (stored_size_bytes > 0),
  width integer check (width > 0),
  height integer check (height > 0),
  sha256 text check (sha256 ~ '^[0-9a-f]{64}$'),
  object_path text not null unique,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  reservation_expires_at timestamptz not null default (now() + interval '2 hours'),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, location_id)
    references public.locations(tenant_id, id)
    on delete cascade,
  foreign key (tenant_id, created_by)
    references public.tenant_memberships(tenant_id, user_id)
    on delete restrict,
  check (
    reservation_expires_at > created_at
  ),
  check (
    object_path = 'tenants/' || tenant_id::text
      || '/locations/' || location_id::text
      || '/business-profile/' || kind || '/' || id::text
      || case content_type
        when 'image/jpeg' then '.jpg'
        when 'image/png' then '.png'
        when 'image/webp' then '.webp'
      end
  ),
  check (
    (status = 'ready' and stored_size_bytes is not null and width is not null
      and height is not null and sha256 is not null)
    or (status <> 'ready')
  )
);

create index business_media_assets_tenant_quota_idx
  on private.business_media_assets (tenant_id, status, source_size_bytes);

revoke all on table private.business_media_assets
from public, anon, authenticated, authenticator;

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

  if target_kind not in ('cover', 'logo', 'reference') then
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

revoke all on function private.reserve_business_media_asset(
  uuid, uuid, uuid, text, text, bigint
) from public, anon, authenticated;
grant execute on function private.reserve_business_media_asset(
  uuid, uuid, uuid, text, text, bigint
) to authenticator;

create or replace function private.complete_business_media_asset(
  target_tenant_id uuid,
  target_asset_id uuid,
  target_stored_size_bytes bigint,
  target_width integer,
  target_height integer,
  target_sha256 text
)
returns private.business_media_assets
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  current_asset private.business_media_assets%rowtype;
begin
  select *
  into current_asset
  from private.business_media_assets asset
  where asset.tenant_id = target_tenant_id
    and asset.id = target_asset_id
  for update;

  if not found then
    raise exception 'business media asset not found' using errcode = '22023';
  end if;

  if target_stored_size_bytes < 1 or target_stored_size_bytes > 12582912
    or target_width < 1 or target_width > 12000
    or target_height < 1 or target_height > 12000
    or target_sha256 !~ '^[0-9a-f]{64}$'
  then
    raise exception 'invalid processed business media metadata'
      using errcode = '22023';
  end if;

  if current_asset.status = 'ready' then
    if current_asset.stored_size_bytes = target_stored_size_bytes
      and current_asset.width = target_width
      and current_asset.height = target_height
      and current_asset.sha256 = target_sha256
    then
      return current_asset;
    end if;
    raise exception 'business media completion conflicts with ready asset'
      using errcode = '22023';
  end if;

  if current_asset.status <> 'reserved'
    or current_asset.reservation_expires_at <= statement_timestamp()
  then
    raise exception 'business media reservation is not active'
      using errcode = '22023';
  end if;

  update private.business_media_assets asset
  set
    status = 'ready',
    stored_size_bytes = target_stored_size_bytes,
    width = target_width,
    height = target_height,
    sha256 = target_sha256,
    updated_at = statement_timestamp()
  where asset.tenant_id = target_tenant_id
    and asset.id = target_asset_id
  returning * into current_asset;

  return current_asset;
end;
$$;

revoke all on function private.complete_business_media_asset(
  uuid, uuid, bigint, integer, integer, text
) from public, anon, authenticated;
grant execute on function private.complete_business_media_asset(
  uuid, uuid, bigint, integer, integer, text
) to authenticator;

create or replace function private.fail_business_media_asset(
  target_tenant_id uuid,
  target_asset_id uuid
)
returns private.business_media_assets
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  current_asset private.business_media_assets%rowtype;
begin
  select *
  into current_asset
  from private.business_media_assets asset
  where asset.tenant_id = target_tenant_id
    and asset.id = target_asset_id
  for update;

  if not found then
    raise exception 'business media asset not found' using errcode = '22023';
  end if;

  if current_asset.status = 'failed' then
    return current_asset;
  end if;
  if current_asset.status <> 'reserved' then
    raise exception 'only a reserved business media asset can fail'
      using errcode = '22023';
  end if;

  update private.business_media_assets asset
  set
    status = 'failed',
    updated_at = statement_timestamp()
  where asset.tenant_id = target_tenant_id
    and asset.id = target_asset_id
  returning * into current_asset;

  return current_asset;
end;
$$;

revoke all on function private.fail_business_media_asset(
  uuid, uuid
) from public, anon, authenticated;
grant execute on function private.fail_business_media_asset(
  uuid, uuid
) to authenticator;

commit;
