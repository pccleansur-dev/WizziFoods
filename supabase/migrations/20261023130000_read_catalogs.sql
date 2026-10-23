begin;

create or replace function private.get_catalog_draft(
  target_tenant_id uuid,
  target_location_id uuid,
  target_requester_id uuid
)
returns setof private.catalog_drafts
language plpgsql
stable
security definer
set search_path = ''
set row_security = off
as $$
begin
  perform private.require_catalog_admin(
    target_tenant_id,
    target_location_id,
    target_requester_id
  );

  return query
  select draft.*
  from private.catalog_drafts draft
  where draft.tenant_id = target_tenant_id
    and draft.location_id = target_location_id;
end;
$$;

create or replace function private.get_current_catalog(
  target_tenant_id uuid,
  target_location_id uuid
)
returns table (
  revision integer,
  snapshot jsonb,
  published_at timestamptz,
  availability jsonb
)
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  with current_publication as (
    select published.revision, published.snapshot, published.published_at
    from private.published_catalogs published
    where published.tenant_id = target_tenant_id
      and published.location_id = target_location_id
    order by published.revision desc
    limit 1
  )
  select
    publication.revision,
    publication.snapshot,
    publication.published_at,
    coalesce(
      (
        select jsonb_object_agg(
          product_availability.product_id::text,
          jsonb_build_object(
            'isAvailable', product_availability.is_available,
            'version', product_availability.version
          )
        )
        from private.catalog_product_availability product_availability
        where product_availability.tenant_id = target_tenant_id
          and product_availability.location_id = target_location_id
          and exists (
            select 1
            from jsonb_array_elements(publication.snapshot -> 'products') product
            where product ->> 'id' = product_availability.product_id::text
          )
      ),
      '{}'::jsonb
    ) as availability
  from current_publication publication;
$$;

revoke all on function private.get_catalog_draft(uuid, uuid, uuid)
from public, anon, authenticated;
revoke all on function private.get_current_catalog(uuid, uuid)
from public, anon, authenticated;

grant execute on function private.get_catalog_draft(uuid, uuid, uuid)
to authenticator;
grant execute on function private.get_current_catalog(uuid, uuid)
to authenticator;

commit;
