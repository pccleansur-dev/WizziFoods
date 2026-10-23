begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(6);

insert into auth.users (id)
values
  ('a1100000-0000-4000-8000-000000000001'),
  ('a1200000-0000-4000-8000-000000000002');

insert into public.tenants (id, slug, name, status)
values
  ('a1300000-0000-4000-8000-000000000003', 'catalog-media-one', 'Catalog Media One', 'draft'),
  ('a1400000-0000-4000-8000-000000000004', 'catalog-media-two', 'Catalog Media Two', 'draft');

insert into public.tenant_memberships (tenant_id, user_id, role)
values
  ('a1300000-0000-4000-8000-000000000003', 'a1100000-0000-4000-8000-000000000001', 'admin'),
  ('a1400000-0000-4000-8000-000000000004', 'a1200000-0000-4000-8000-000000000002', 'admin');

create temporary table catalog_media_fixtures on commit drop as
select
  'ready_product'::text as fixture,
  (private.reserve_business_media_asset(
    'a1300000-0000-4000-8000-000000000003',
    (select id from public.locations where tenant_id = 'a1300000-0000-4000-8000-000000000003'),
    'a1100000-0000-4000-8000-000000000001',
    'product', 'image/webp', 1024
  )).id as asset_id
union all
select
  'reserved_product',
  (private.reserve_business_media_asset(
    'a1300000-0000-4000-8000-000000000003',
    (select id from public.locations where tenant_id = 'a1300000-0000-4000-8000-000000000003'),
    'a1100000-0000-4000-8000-000000000001',
    'product', 'image/jpeg', 1024
  )).id
union all
select
  'foreign_product',
  (private.reserve_business_media_asset(
    'a1400000-0000-4000-8000-000000000004',
    (select id from public.locations where tenant_id = 'a1400000-0000-4000-8000-000000000004'),
    'a1200000-0000-4000-8000-000000000002',
    'product', 'image/png', 1024
  )).id
union all
select
  'ready_reference',
  (private.reserve_business_media_asset(
    'a1300000-0000-4000-8000-000000000003',
    (select id from public.locations where tenant_id = 'a1300000-0000-4000-8000-000000000003'),
    'a1100000-0000-4000-8000-000000000001',
    'reference', 'image/jpeg', 1024
  )).id;

select private.complete_business_media_asset(
  case when fixture = 'foreign_product'
    then 'a1400000-0000-4000-8000-000000000004'::uuid
    else 'a1300000-0000-4000-8000-000000000003'::uuid
  end,
  asset_id,
  768,
  640,
  480,
  repeat(case fixture
    when 'ready_product' then 'a'
    when 'foreign_product' then 'b'
    else 'c'
  end, 64)
)
from catalog_media_fixtures
where fixture <> 'reserved_product';

select is(
  (select kind from private.business_media_assets where id = (
    select asset_id from catalog_media_fixtures where fixture = 'ready_product'
  )),
  'product',
  'product media can be reserved under the shared upload policy'
);

select lives_ok(
  format(
    $query$
      select * from private.save_catalog_draft(
        'a1300000-0000-4000-8000-000000000003',
        (select id from public.locations where tenant_id = 'a1300000-0000-4000-8000-000000000003'),
        'a1100000-0000-4000-8000-000000000001',
        jsonb_build_object(
          'baseRevision', null,
          'categories', '[]'::jsonb,
          'sectors', '[]'::jsonb,
          'products', jsonb_build_array(jsonb_build_object('imageAssetId', %L::text))
        )
      )
    $query$,
    (select asset_id from catalog_media_fixtures where fixture = 'ready_product')
  ),
  'a catalog accepts a ready product image from its own location'
);

select throws_ok(
  format(
    $query$
      select * from private.save_catalog_draft(
        'a1300000-0000-4000-8000-000000000003',
        (select id from public.locations where tenant_id = 'a1300000-0000-4000-8000-000000000003'),
        'a1100000-0000-4000-8000-000000000001',
        jsonb_build_object(
          'baseRevision', null,
          'categories', '[]'::jsonb,
          'sectors', '[]'::jsonb,
          'products', jsonb_build_array(jsonb_build_object('imageAssetId', %L::text))
        )
      )
    $query$,
    (select asset_id from catalog_media_fixtures where fixture = 'reserved_product')
  ),
  '22023',
  'catalog product images must be ready, tenant-scoped, location-scoped, and product media',
  'a catalog rejects a product image that has not finished processing'
);

select throws_ok(
  format(
    $query$
      select * from private.save_catalog_draft(
        'a1300000-0000-4000-8000-000000000003',
        (select id from public.locations where tenant_id = 'a1300000-0000-4000-8000-000000000003'),
        'a1100000-0000-4000-8000-000000000001',
        jsonb_build_object(
          'baseRevision', null,
          'categories', '[]'::jsonb,
          'sectors', '[]'::jsonb,
          'products', jsonb_build_array(jsonb_build_object('imageAssetId', %L::text))
        )
      )
    $query$,
    (select asset_id from catalog_media_fixtures where fixture = 'foreign_product')
  ),
  '22023',
  'catalog product images must be ready, tenant-scoped, location-scoped, and product media',
  'a catalog rejects product media owned by another tenant'
);

select throws_ok(
  format(
    $query$
      select * from private.save_catalog_draft(
        'a1300000-0000-4000-8000-000000000003',
        (select id from public.locations where tenant_id = 'a1300000-0000-4000-8000-000000000003'),
        'a1100000-0000-4000-8000-000000000001',
        jsonb_build_object(
          'baseRevision', null,
          'categories', '[]'::jsonb,
          'sectors', '[]'::jsonb,
          'products', jsonb_build_array(jsonb_build_object('imageAssetId', %L::text))
        )
      )
    $query$,
    (select asset_id from catalog_media_fixtures where fixture = 'ready_reference')
  ),
  '22023',
  'catalog product images must be ready, tenant-scoped, location-scoped, and product media',
  'a catalog rejects ready media assigned to another role'
);

select throws_ok(
  $$
    update private.catalog_drafts
    set snapshot = jsonb_set(
      snapshot,
      '{products,0,imageAssetId}',
      to_jsonb('00000000-0000-4000-8000-000000000099'::text)
    )
    where tenant_id = 'a1300000-0000-4000-8000-000000000003'
  $$,
  '22023',
  'catalog product images must be ready, tenant-scoped, location-scoped, and product media',
  'the table boundary rejects invalid catalog media references'
);

select * from finish();
rollback;
