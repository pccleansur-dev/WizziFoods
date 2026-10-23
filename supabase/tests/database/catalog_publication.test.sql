begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(18);

insert into auth.users (id)
values
  ('e1000000-0000-4000-8000-000000000001'),
  ('e2000000-0000-4000-8000-000000000002');

insert into public.tenants (id, slug, name, status)
values
  ('e3000000-0000-4000-8000-000000000003', 'catalog-one', 'Catalog One', 'draft'),
  ('e4000000-0000-4000-8000-000000000004', 'catalog-two', 'Catalog Two', 'draft');

insert into public.tenant_memberships (tenant_id, user_id, role)
values
  ('e3000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-000000000001', 'admin'),
  ('e4000000-0000-4000-8000-000000000004', 'e2000000-0000-4000-8000-000000000002', 'admin');

select *
from private.save_business_profile_draft(
  'e3000000-0000-4000-8000-000000000003',
  (select id from public.locations where tenant_id = 'e3000000-0000-4000-8000-000000000003'),
  'e1000000-0000-4000-8000-000000000001',
  'Catalog One', '', '', '', '', array['es'],
  'visual', 'serif', '#1F2937', '#F9FAFB', '#D97706',
  null, null, '{}'::uuid[]
);

select has_table('private', 'catalog_drafts', 'catalog drafts are private');
select has_table('private', 'published_catalogs', 'published versions are immutable rows');
select has_table(
  'private',
  'catalog_product_availability',
  'availability is stored independently from content versions'
);
select table_privs_are(
  'private',
  'catalog_drafts',
  'authenticator',
  array[]::text[],
  'the API runtime cannot bypass catalog functions'
);

create temporary table first_draft on commit drop as
select *
from private.save_catalog_draft(
  'e3000000-0000-4000-8000-000000000003',
  (select id from public.locations where tenant_id = 'e3000000-0000-4000-8000-000000000003'),
  'e1000000-0000-4000-8000-000000000001',
  '{
    "baseRevision": null,
    "categories": [{"id":"e5000000-0000-4000-8000-000000000005","position":0,"content":[{"language":"es","title":"Principales","description":""}]}],
    "sectors": [{"id":"e6000000-0000-4000-8000-000000000006","position":0,"kind":"kitchen","name":"Cocina"}],
    "products": [{"id":"e7000000-0000-4000-8000-000000000007","categoryId":"e5000000-0000-4000-8000-000000000005","sectorId":"e6000000-0000-4000-8000-000000000006","position":0,"priceCents":125000,"imageAssetId":null,"content":[{"language":"es","title":"Milanesa","description":"Con papas"}],"variants":[]}]
  }'::jsonb
);

select results_eq(
  $$ select revision, base_published_revision, is_dirty from first_draft $$,
  $$ values (1, null::integer, true) $$,
  'the first save creates an unpublished draft'
);
select throws_ok(
  $$
    select * from private.save_catalog_draft(
      'e3000000-0000-4000-8000-000000000003',
      (select id from public.locations where tenant_id = 'e3000000-0000-4000-8000-000000000003'),
      'e1000000-0000-4000-8000-000000000001',
      '{"baseRevision":null,"categories":[],"sectors":[],"products":[{"isAvailable":true}]}'::jsonb
    )
  $$,
  '22023',
  null,
  'availability cannot be smuggled into a content draft'
);

create temporary table first_publication on commit drop as
select *
from private.publish_catalog(
  'e3000000-0000-4000-8000-000000000003',
  (select id from public.locations where tenant_id = 'e3000000-0000-4000-8000-000000000003'),
  'e1000000-0000-4000-8000-000000000001',
  1
);

select results_eq(
  $$ select revision, source_draft_revision from first_publication $$,
  $$ values (1, 1) $$,
  'publishing creates the first immutable version atomically'
);
select results_eq(
  $$
    select base_published_revision, is_dirty, snapshot ->> 'baseRevision'
    from private.catalog_drafts
    where tenant_id = 'e3000000-0000-4000-8000-000000000003'
  $$,
  $$ values (1, false, '1'::text) $$,
  'publishing rebases and marks the draft clean'
);
select is(
  (select snapshot #>> '{products,0,content,0,title}' from first_publication),
  'Milanesa',
  'the published snapshot contains the reviewed content'
);

create temporary table second_draft on commit drop as
select *
from private.save_catalog_draft(
  'e3000000-0000-4000-8000-000000000003',
  (select id from public.locations where tenant_id = 'e3000000-0000-4000-8000-000000000003'),
  'e1000000-0000-4000-8000-000000000001',
  '{
    "baseRevision": 1,
    "categories": [{"id":"e5000000-0000-4000-8000-000000000005","position":0,"content":[{"language":"es","title":"Principales","description":""}]}],
    "sectors": [{"id":"e6000000-0000-4000-8000-000000000006","position":0,"kind":"kitchen","name":"Cocina"}],
    "products": [{"id":"e7000000-0000-4000-8000-000000000007","categoryId":"e5000000-0000-4000-8000-000000000005","sectorId":"e6000000-0000-4000-8000-000000000006","position":0,"priceCents":130000,"imageAssetId":null,"content":[{"language":"es","title":"Milanesa especial","description":"Con papas"}],"variants":[]}]
  }'::jsonb
);

select results_eq(
  $$ select revision, base_published_revision, is_dirty from second_draft $$,
  $$ values (2, 1, true) $$,
  'saving reviewed changes advances only the draft revision'
);
select is(
  (
    select snapshot #>> '{products,0,content,0,title}'
    from private.published_catalogs
    where tenant_id = 'e3000000-0000-4000-8000-000000000003'
      and revision = 1
  ),
  'Milanesa',
  'draft changes do not leak into the published catalog'
);
select throws_ok(
  $$
    select * from private.publish_catalog(
      'e3000000-0000-4000-8000-000000000003',
      (select id from public.locations where tenant_id = 'e3000000-0000-4000-8000-000000000003'),
      'e1000000-0000-4000-8000-000000000001',
      1
    )
  $$,
  '40001',
  null,
  'a stale editor cannot publish a newer draft revision'
);
select is(
  (
    select revision
    from private.publish_catalog(
      'e3000000-0000-4000-8000-000000000003',
      (select id from public.locations where tenant_id = 'e3000000-0000-4000-8000-000000000003'),
      'e1000000-0000-4000-8000-000000000001',
      2
    )
  ),
  2,
  'the current draft publishes as the next catalog version'
);

select results_eq(
  $$
    select is_available, version
    from private.set_catalog_product_availability(
      'e3000000-0000-4000-8000-000000000003',
      (select id from public.locations where tenant_id = 'e3000000-0000-4000-8000-000000000003'),
      'e1000000-0000-4000-8000-000000000001',
      'e7000000-0000-4000-8000-000000000007',
      false,
      null
    )
  $$,
  $$ values (false, 1) $$,
  'availability can change immediately without publishing content'
);
select results_eq(
  $$
    select is_available, version
    from private.set_catalog_product_availability(
      'e3000000-0000-4000-8000-000000000003',
      (select id from public.locations where tenant_id = 'e3000000-0000-4000-8000-000000000003'),
      'e1000000-0000-4000-8000-000000000001',
      'e7000000-0000-4000-8000-000000000007',
      true,
      1
    )
  $$,
  $$ values (true, 2) $$,
  'the availability version advances after a valid toggle'
);
select throws_ok(
  $$
    select * from private.set_catalog_product_availability(
      'e3000000-0000-4000-8000-000000000003',
      (select id from public.locations where tenant_id = 'e3000000-0000-4000-8000-000000000003'),
      'e1000000-0000-4000-8000-000000000001',
      'e7000000-0000-4000-8000-000000000007',
      false,
      1
    )
  $$,
  '40001',
  null,
  'a concurrent stale availability toggle is rejected'
);
select is(
  (
    select snapshot #>> '{products,0,content,0,title}'
    from private.published_catalogs
    where tenant_id = 'e3000000-0000-4000-8000-000000000003'
      and revision = 2
  ),
  'Milanesa especial',
  'availability toggles do not alter the published content snapshot'
);
select throws_ok(
  $$
    select * from private.save_catalog_draft(
      'e3000000-0000-4000-8000-000000000003',
      (select id from public.locations where tenant_id = 'e3000000-0000-4000-8000-000000000003'),
      'e2000000-0000-4000-8000-000000000002',
      '{"baseRevision":2,"categories":[],"sectors":[],"products":[]}'::jsonb
    )
  $$,
  '42501',
  null,
  'an administrator from another tenant cannot overwrite the draft'
);

select * from finish();
rollback;
