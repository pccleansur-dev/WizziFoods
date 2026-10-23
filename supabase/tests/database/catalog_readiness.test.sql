begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(4);

insert into auth.users (id)
values ('d1000000-0000-4000-8000-000000000001');

insert into public.tenants (id, slug, name, status)
values ('d2000000-0000-4000-8000-000000000002', 'catalog-ready', 'Catalog Ready', 'draft');

insert into public.tenant_memberships (tenant_id, user_id, role)
values (
  'd2000000-0000-4000-8000-000000000002',
  'd1000000-0000-4000-8000-000000000001',
  'admin'
);

select *
from private.save_catalog_draft(
  'd2000000-0000-4000-8000-000000000002',
  (select id from public.locations where tenant_id = 'd2000000-0000-4000-8000-000000000002'),
  'd1000000-0000-4000-8000-000000000001',
  '{"baseRevision":null,"categories":[],"sectors":[],"products":[]}'::jsonb
);

select throws_ok(
  $$
    select * from private.publish_catalog(
      'd2000000-0000-4000-8000-000000000002',
      (select id from public.locations where tenant_id = 'd2000000-0000-4000-8000-000000000002'),
      'd1000000-0000-4000-8000-000000000001',
      1
    )
  $$,
  '22023',
  'catalog publication requirements missing: BUSINESS_IDENTITY',
  'publication requires the business identity draft'
);

select *
from private.save_business_profile_draft(
  'd2000000-0000-4000-8000-000000000002',
  (select id from public.locations where tenant_id = 'd2000000-0000-4000-8000-000000000002'),
  'd1000000-0000-4000-8000-000000000001',
  'Restaurante listo', '', '', '', '', array['es', 'en'],
  'visual', 'serif', '#1F2937', '#F9FAFB', '#D97706',
  null, null, '{}'::uuid[]
);

select throws_ok(
  $$
    select * from private.publish_catalog(
      'd2000000-0000-4000-8000-000000000002',
      (select id from public.locations where tenant_id = 'd2000000-0000-4000-8000-000000000002'),
      'd1000000-0000-4000-8000-000000000001',
      1
    )
  $$,
  '22023',
  'catalog publication requirements missing: MISSING_CATEGORY,MISSING_SECTOR,MISSING_PRODUCT',
  'an incomplete draft remains saveable but cannot be published'
);

select *
from private.save_catalog_draft(
  'd2000000-0000-4000-8000-000000000002',
  (select id from public.locations where tenant_id = 'd2000000-0000-4000-8000-000000000002'),
  'd1000000-0000-4000-8000-000000000001',
  '{
    "baseRevision": null,
    "categories": [{"id":"d3000000-0000-4000-8000-000000000003","position":0,"content":[{"language":"es","title":"Principales","description":""}]}],
    "sectors": [{"id":"d4000000-0000-4000-8000-000000000004","position":0,"kind":"kitchen","name":"Cocina"}],
    "products": [{"id":"d5000000-0000-4000-8000-000000000005","categoryId":"d3000000-0000-4000-8000-000000000003","sectorId":"d4000000-0000-4000-8000-000000000004","position":0,"priceCents":125000,"imageAssetId":null,"content":[{"language":"es","title":"Milanesa","description":"Con papas"}],"variants":[{"id":"d6000000-0000-4000-8000-000000000006","position":0,"priceDeltaCents":25000,"content":[{"language":"es","title":"Napolitana","description":""}]}]}]
  }'::jsonb
);

select throws_ok(
  $$
    select * from private.publish_catalog(
      'd2000000-0000-4000-8000-000000000002',
      (select id from public.locations where tenant_id = 'd2000000-0000-4000-8000-000000000002'),
      'd1000000-0000-4000-8000-000000000001',
      2
    )
  $$,
  '22023',
  'catalog publication requirements missing: MISSING_LOCALIZED_CONTENT',
  'every configured language is required for categories, products, and variants'
);

select *
from private.save_catalog_draft(
  'd2000000-0000-4000-8000-000000000002',
  (select id from public.locations where tenant_id = 'd2000000-0000-4000-8000-000000000002'),
  'd1000000-0000-4000-8000-000000000001',
  '{
    "baseRevision": null,
    "categories": [{"id":"d3000000-0000-4000-8000-000000000003","position":0,"content":[{"language":"es","title":"Principales","description":""},{"language":"en","title":"Main dishes","description":""}]}],
    "sectors": [{"id":"d4000000-0000-4000-8000-000000000004","position":0,"kind":"kitchen","name":"Cocina"}],
    "products": [{"id":"d5000000-0000-4000-8000-000000000005","categoryId":"d3000000-0000-4000-8000-000000000003","sectorId":"d4000000-0000-4000-8000-000000000004","position":0,"priceCents":125000,"imageAssetId":null,"content":[{"language":"es","title":"Milanesa","description":"Con papas"},{"language":"en","title":"Milanese","description":"With potatoes"}],"variants":[{"id":"d6000000-0000-4000-8000-000000000006","position":0,"priceDeltaCents":25000,"content":[{"language":"es","title":"Napolitana","description":""},{"language":"en","title":"Neapolitan","description":""}]}]}]
  }'::jsonb
);

select is(
  (
    select revision
    from private.publish_catalog(
      'd2000000-0000-4000-8000-000000000002',
      (select id from public.locations where tenant_id = 'd2000000-0000-4000-8000-000000000002'),
      'd1000000-0000-4000-8000-000000000001',
      3
    )
  ),
  1,
  'a complete multilingual catalog publishes atomically'
);

select * from finish();
rollback;
