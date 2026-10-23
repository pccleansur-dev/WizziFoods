begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(12);

insert into auth.users (id)
values
  ('e1000000-0000-4000-8000-000000000001'),
  ('e2000000-0000-4000-8000-000000000002');

insert into public.tenants (id, slug, name, status)
values
  ('e3000000-0000-4000-8000-000000000003', 'media-one', 'Media One', 'draft'),
  ('e4000000-0000-4000-8000-000000000004', 'media-two', 'Media Two', 'draft');

insert into public.tenant_memberships (tenant_id, user_id, role)
values
  ('e3000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-000000000001', 'admin'),
  ('e4000000-0000-4000-8000-000000000004', 'e2000000-0000-4000-8000-000000000002', 'admin');

select has_table('private', 'business_media_assets', 'media metadata is private');
select is(
  (select public from storage.buckets where id = 'business-media'),
  false,
  'the business media bucket is private'
);
select is(
  (select file_size_limit from storage.buckets where id = 'business-media'),
  12582912::bigint,
  'the bucket enforces the source file limit'
);
select table_privs_are(
  'private',
  'business_media_assets',
  'authenticator',
  array[]::text[],
  'the API runtime cannot bypass media reservations'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'private.reserve_business_media_asset(uuid,uuid,uuid,text,text,bigint)',
    'EXECUTE'
  ),
  'browser identities cannot reserve paths directly'
);

create temporary table reserved_media on commit drop as
select *
from private.reserve_business_media_asset(
  'e3000000-0000-4000-8000-000000000003',
  (select id from public.locations where tenant_id = 'e3000000-0000-4000-8000-000000000003'),
  'e1000000-0000-4000-8000-000000000001',
  'logo',
  'image/jpeg',
  2048
);

select results_eq(
  $$ select status, kind, content_type, source_size_bytes from reserved_media $$,
  $$ values ('reserved'::text, 'logo'::text, 'image/jpeg'::text, 2048::bigint) $$,
  'an administrator reserves valid media metadata'
);
select ok(
  (select object_path from reserved_media) ~ (
    '^tenants/e3000000-0000-4000-8000-000000000003/locations/'
    || '[0-9a-f-]{36}/business-profile/logo/[0-9a-f-]{36}[.]jpg$'
  ),
  'the server derives an opaque tenant-scoped object path'
);
select ok(
  (select reservation_expires_at > created_at from reserved_media),
  'an abandoned reservation expires instead of consuming quota forever'
);
select throws_ok(
  $$
    select * from private.reserve_business_media_asset(
      'e3000000-0000-4000-8000-000000000003',
      (select id from public.locations where tenant_id = 'e3000000-0000-4000-8000-000000000003'),
      'e2000000-0000-4000-8000-000000000002',
      'cover', 'image/png', 1024
    )
  $$,
  '42501',
  null,
  'an administrator from another tenant cannot reserve a path'
);
select throws_ok(
  $$
    select * from private.reserve_business_media_asset(
      'e3000000-0000-4000-8000-000000000003',
      (select id from public.locations where tenant_id = 'e3000000-0000-4000-8000-000000000003'),
      'e1000000-0000-4000-8000-000000000001',
      'logo', 'image/svg+xml', 1024
    )
  $$,
  '22023',
  null,
  'active content such as SVG is rejected'
);
select throws_ok(
  $$
    select * from private.reserve_business_media_asset(
      'e3000000-0000-4000-8000-000000000003',
      (select id from public.locations where tenant_id = 'e3000000-0000-4000-8000-000000000003'),
      'e1000000-0000-4000-8000-000000000001',
      'cover', 'image/png', 12582913
    )
  $$,
  '22023',
  null,
  'a source over twelve MiB is rejected'
);

with generated_assets as (
  select gen_random_uuid() as id
  from generate_series(1, 85)
)
insert into private.business_media_assets (
  id,
  tenant_id,
  location_id,
  kind,
  content_type,
  source_size_bytes,
  object_path,
  created_by
)
select
  generated.id,
  'e3000000-0000-4000-8000-000000000003',
  (select id from public.locations where tenant_id = 'e3000000-0000-4000-8000-000000000003'),
  'reference',
  'image/jpeg',
  12582912,
  'tenants/e3000000-0000-4000-8000-000000000003/locations/'
    || (select id::text from public.locations where tenant_id = 'e3000000-0000-4000-8000-000000000003')
    || '/business-profile/reference/' || generated.id::text || '.jpg',
  'e1000000-0000-4000-8000-000000000001'
from generated_assets generated;

select throws_ok(
  $$
    select * from private.reserve_business_media_asset(
      'e3000000-0000-4000-8000-000000000003',
      (select id from public.locations where tenant_id = 'e3000000-0000-4000-8000-000000000003'),
      'e1000000-0000-4000-8000-000000000001',
      'reference', 'image/webp', 4194305
    )
  $$,
  '22023',
  null,
  'the tenant quota includes reserved uploads'
);

select * from finish();
rollback;
