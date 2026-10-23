begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(8);

insert into auth.users (id)
values
  ('f1000000-0000-4000-8000-000000000001'),
  ('f2000000-0000-4000-8000-000000000002');

insert into public.tenants (id, slug, name, status)
values
  ('f3000000-0000-4000-8000-000000000003', 'catalog-read-one', 'Catalog Read One', 'draft'),
  ('f4000000-0000-4000-8000-000000000004', 'catalog-read-two', 'Catalog Read Two', 'draft');

insert into public.tenant_memberships (tenant_id, user_id, role)
values
  ('f3000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000001', 'admin'),
  ('f4000000-0000-4000-8000-000000000004', 'f2000000-0000-4000-8000-000000000002', 'admin');

select ok(
  has_function_privilege(
    'authenticator',
    'private.get_catalog_draft(uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'the API runtime can load an authorized draft'
);
select ok(
  has_function_privilege(
    'authenticator',
    'private.get_current_catalog(uuid,uuid)',
    'EXECUTE'
  ),
  'the API runtime can load the public catalog for a resolved tenant'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'private.get_current_catalog(uuid,uuid)',
    'EXECUTE'
  ),
  'browser identities cannot bypass the host-scoped API'
);

create temporary table saved_read_draft on commit drop as
select *
from private.save_catalog_draft(
  'f3000000-0000-4000-8000-000000000003',
  (select id from public.locations where tenant_id = 'f3000000-0000-4000-8000-000000000003'),
  'f1000000-0000-4000-8000-000000000001',
  '{
    "baseRevision": null,
    "categories": [{"id":"f5000000-0000-4000-8000-000000000005","position":0,"content":[{"language":"es","title":"Principales","description":""}]}],
    "sectors": [{"id":"f6000000-0000-4000-8000-000000000006","position":0,"kind":"kitchen","name":"Cocina"}],
    "products": [{"id":"f7000000-0000-4000-8000-000000000007","categoryId":"f5000000-0000-4000-8000-000000000005","sectorId":"f6000000-0000-4000-8000-000000000006","position":0,"priceCents":125000,"imageAssetId":null,"content":[{"language":"es","title":"Milanesa","description":"Con papas"}],"variants":[]}]
  }'::jsonb
);

select is(
  (
    select revision
    from private.get_catalog_draft(
      'f3000000-0000-4000-8000-000000000003',
      (select id from public.locations where tenant_id = 'f3000000-0000-4000-8000-000000000003'),
      'f1000000-0000-4000-8000-000000000001'
    )
  ),
  1,
  'an administrator can resume the current draft'
);
select throws_ok(
  $$
    select * from private.get_catalog_draft(
      'f3000000-0000-4000-8000-000000000003',
      (select id from public.locations where tenant_id = 'f3000000-0000-4000-8000-000000000003'),
      'f2000000-0000-4000-8000-000000000002'
    )
  $$,
  '42501',
  null,
  'an administrator from another tenant cannot read the draft'
);

select *
from private.publish_catalog(
  'f3000000-0000-4000-8000-000000000003',
  (select id from public.locations where tenant_id = 'f3000000-0000-4000-8000-000000000003'),
  'f1000000-0000-4000-8000-000000000001',
  1
);
select *
from private.set_catalog_product_availability(
  'f3000000-0000-4000-8000-000000000003',
  (select id from public.locations where tenant_id = 'f3000000-0000-4000-8000-000000000003'),
  'f1000000-0000-4000-8000-000000000001',
  'f7000000-0000-4000-8000-000000000007',
  false,
  null
);

select results_eq(
  $$
    select revision, snapshot #>> '{products,0,content,0,title}'
    from private.get_current_catalog(
      'f3000000-0000-4000-8000-000000000003',
      (select id from public.locations where tenant_id = 'f3000000-0000-4000-8000-000000000003')
    )
  $$,
  $$ values (1, 'Milanesa'::text) $$,
  'the public read returns only the current published version'
);
select is(
  (
    select availability #>> array['f7000000-0000-4000-8000-000000000007', 'isAvailable']
    from private.get_current_catalog(
      'f3000000-0000-4000-8000-000000000003',
      (select id from public.locations where tenant_id = 'f3000000-0000-4000-8000-000000000003')
    )
  ),
  'false',
  'the public read overlays immediate availability separately'
);
select is_empty(
  $$
    select * from private.get_current_catalog(
      'f4000000-0000-4000-8000-000000000004',
      (select id from public.locations where tenant_id = 'f4000000-0000-4000-8000-000000000004')
    )
  $$,
  'an unpublished tenant cannot observe another tenant catalog'
);

select * from finish();
rollback;
