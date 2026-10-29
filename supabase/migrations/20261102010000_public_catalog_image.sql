begin;

-- The photo of a product, for the diner. It answers only for an image that the CURRENT
-- published catalog of this restaurant and location points at, and only while the asset is a
-- ready product photo of the same restaurant and location. Anything else is "nothing": an
-- asset of another restaurant, a draft-only photo or a removed product look the same.

create function private.get_public_catalog_image(
  target_tenant_id uuid,
  target_location_id uuid,
  target_asset_id uuid
)
returns table (object_path text, content_type text, version text)
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select asset.object_path, asset.content_type, left(asset.sha256, 16)
  from private.business_media_assets asset
  where asset.id = target_asset_id
    and asset.tenant_id = target_tenant_id
    and asset.location_id = target_location_id
    and asset.kind = 'product'
    and asset.status = 'ready'
    and exists (
      select 1
      from (
        select published.snapshot
        from private.published_catalogs published
        where published.tenant_id = target_tenant_id
          and published.location_id = target_location_id
        order by published.revision desc
        limit 1
      ) current_publication,
      jsonb_array_elements(current_publication.snapshot -> 'products') product
      where product ->> 'imageAssetId' = target_asset_id::text
    );
$$;

revoke all on function private.get_public_catalog_image(uuid, uuid, uuid)
from public, anon, authenticated, authenticator;
grant execute on function private.get_public_catalog_image(uuid, uuid, uuid)
to authenticator;

commit;
