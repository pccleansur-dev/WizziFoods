begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(5);

insert into auth.users (id)
values
  ('f1000000-0000-4000-8000-000000000001'),
  ('f2000000-0000-4000-8000-000000000002');

insert into public.tenants (id, slug, name, status)
values
  ('f3000000-0000-4000-8000-000000000003', 'profile-media-one', 'Profile Media One', 'draft'),
  ('f4000000-0000-4000-8000-000000000004', 'profile-media-two', 'Profile Media Two', 'draft');

insert into public.tenant_memberships (tenant_id, user_id, role)
values
  ('f3000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000001', 'admin'),
  ('f4000000-0000-4000-8000-000000000004', 'f2000000-0000-4000-8000-000000000002', 'admin');

create temporary table media_fixtures on commit drop as
select
  'ready_logo'::text as fixture,
  (private.reserve_business_media_asset(
    'f3000000-0000-4000-8000-000000000003',
    (select id from public.locations where tenant_id = 'f3000000-0000-4000-8000-000000000003'),
    'f1000000-0000-4000-8000-000000000001',
    'logo', 'image/png', 1024
  )).id as asset_id
union all
select
  'reserved_cover',
  (private.reserve_business_media_asset(
    'f3000000-0000-4000-8000-000000000003',
    (select id from public.locations where tenant_id = 'f3000000-0000-4000-8000-000000000003'),
    'f1000000-0000-4000-8000-000000000001',
    'cover', 'image/jpeg', 1024
  )).id
union all
select
  'foreign_logo',
  (private.reserve_business_media_asset(
    'f4000000-0000-4000-8000-000000000004',
    (select id from public.locations where tenant_id = 'f4000000-0000-4000-8000-000000000004'),
    'f2000000-0000-4000-8000-000000000002',
    'logo', 'image/webp', 1024
  )).id
union all
select
  'ready_reference',
  (private.reserve_business_media_asset(
    'f3000000-0000-4000-8000-000000000003',
    (select id from public.locations where tenant_id = 'f3000000-0000-4000-8000-000000000003'),
    'f1000000-0000-4000-8000-000000000001',
    'reference', 'image/jpeg', 1024
  )).id;

select private.complete_business_media_asset(
  case when fixture = 'foreign_logo'
    then 'f4000000-0000-4000-8000-000000000004'::uuid
    else 'f3000000-0000-4000-8000-000000000003'::uuid
  end,
  asset_id,
  768,
  640,
  480,
  repeat(case fixture
    when 'ready_logo' then 'a'
    when 'foreign_logo' then 'b'
    else 'c'
  end, 64)
)
from media_fixtures
where fixture <> 'reserved_cover';

select lives_ok(
  format(
    $query$
      select * from private.save_business_profile_draft(
        'f3000000-0000-4000-8000-000000000003',
        (select id from public.locations where tenant_id = 'f3000000-0000-4000-8000-000000000003'),
        'f1000000-0000-4000-8000-000000000001',
        'Perfil seguro', '', '', '', '', array['es'],
        'visual', 'serif', '#1F2937', '#F9FAFB', '#D97706',
        %L, null, array[%L]::uuid[]
      )
    $query$,
    (select asset_id from media_fixtures where fixture = 'ready_logo'),
    (select asset_id from media_fixtures where fixture = 'ready_reference')
  ),
  'a profile accepts ready media from its own location with the matching kind'
);

select throws_ok(
  format(
    $query$
      select * from private.save_business_profile_draft(
        'f3000000-0000-4000-8000-000000000003',
        (select id from public.locations where tenant_id = 'f3000000-0000-4000-8000-000000000003'),
        'f1000000-0000-4000-8000-000000000001',
        'Perfil seguro', '', '', '', '', array['es'],
        'visual', 'serif', '#1F2937', '#F9FAFB', '#D97706',
        null, %L, '{}'::uuid[]
      )
    $query$,
    (select asset_id from media_fixtures where fixture = 'reserved_cover')
  ),
  '22023',
  'business profile media must be ready, tenant-scoped, location-scoped, and match its assigned kind',
  'a profile rejects media that has not finished processing'
);

select throws_ok(
  format(
    $query$
      select * from private.save_business_profile_draft(
        'f3000000-0000-4000-8000-000000000003',
        (select id from public.locations where tenant_id = 'f3000000-0000-4000-8000-000000000003'),
        'f1000000-0000-4000-8000-000000000001',
        'Perfil seguro', '', '', '', '', array['es'],
        'visual', 'serif', '#1F2937', '#F9FAFB', '#D97706',
        %L, null, '{}'::uuid[]
      )
    $query$,
    (select asset_id from media_fixtures where fixture = 'foreign_logo')
  ),
  '22023',
  'business profile media must be ready, tenant-scoped, location-scoped, and match its assigned kind',
  'a profile rejects media owned by another tenant'
);

select throws_ok(
  format(
    $query$
      select * from private.save_business_profile_draft(
        'f3000000-0000-4000-8000-000000000003',
        (select id from public.locations where tenant_id = 'f3000000-0000-4000-8000-000000000003'),
        'f1000000-0000-4000-8000-000000000001',
        'Perfil seguro', '', '', '', '', array['es'],
        'visual', 'serif', '#1F2937', '#F9FAFB', '#D97706',
        null, %L, '{}'::uuid[]
      )
    $query$,
    (select asset_id from media_fixtures where fixture = 'ready_logo')
  ),
  '22023',
  'business profile media must be ready, tenant-scoped, location-scoped, and match its assigned kind',
  'a profile rejects a ready asset assigned to the wrong visual role'
);

select throws_ok(
  $$
    update private.business_profile_drafts
    set reference_asset_ids = array['00000000-0000-4000-8000-000000000099']::uuid[]
    where tenant_id = 'f3000000-0000-4000-8000-000000000003'
  $$,
  '22023',
  'business profile media must be ready, tenant-scoped, location-scoped, and match its assigned kind',
  'the table boundary rejects invalid references even outside the save function'
);

select * from finish();
rollback;
