begin;

-- T30 (icons): what the installed app and its notifications show of the restaurant.
-- The name, the colors and the logo are the ones the Encargado already chose in the
-- business profile; this reads them for the PUBLIC page of that very host. It never returns
-- an email, an account, another restaurant or anything that is not already on its public page.
-- A logo counts only if it is a ready asset of kind "logo" of the same restaurant.

create function private.get_public_brand(
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
    'name', coalesce(draft.display_name, tenant.name),
    'primaryColor', coalesce(draft.primary_color, '#1F2937'),
    'backgroundColor', coalesce(draft.secondary_color, '#F9FAFB'),
    'logo', (
      select jsonb_build_object(
        'objectPath', asset.object_path,
        'contentType', asset.content_type,
        'version', left(asset.sha256, 16))
      from private.business_media_assets asset
      where asset.id = draft.logo_asset_id
        and asset.tenant_id = target_tenant_id
        and asset.location_id = target_location_id
        and asset.kind = 'logo'
        and asset.status = 'ready'))
  from public.tenants tenant
  left join private.business_profile_drafts draft
    on draft.tenant_id = tenant.id and draft.location_id = target_location_id
  where tenant.id = target_tenant_id;
$$;

revoke all on function private.get_public_brand(uuid, uuid)
from public, anon, authenticated, authenticator;
grant execute on function private.get_public_brand(uuid, uuid) to authenticator;

commit;
