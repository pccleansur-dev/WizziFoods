begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(10);

insert into auth.users (id)
values
  ('d1000000-0000-4000-8000-000000000001'),
  ('d2000000-0000-4000-8000-000000000002');

insert into public.tenants (id, slug, name, status)
values
  ('d3000000-0000-4000-8000-000000000003', 'profile-one', 'Profile One', 'draft'),
  ('d4000000-0000-4000-8000-000000000004', 'profile-two', 'Profile Two', 'draft');

insert into public.tenant_memberships (tenant_id, user_id, role)
values
  ('d3000000-0000-4000-8000-000000000003', 'd1000000-0000-4000-8000-000000000001', 'admin'),
  ('d4000000-0000-4000-8000-000000000004', 'd2000000-0000-4000-8000-000000000002', 'admin');

select has_table('private', 'business_profile_drafts', 'drafts are persisted privately');
select has_table('private', 'published_business_profiles', 'published snapshots are separate');
select table_privs_are(
  'private',
  'business_profile_drafts',
  'authenticator',
  array[]::text[],
  'the API runtime cannot bypass profile functions'
);
select ok(
  has_function_privilege(
    'authenticator',
    'private.save_business_profile_draft(uuid,uuid,uuid,text,text,text,text,text,text[],text,text,text,text,text,uuid,uuid,uuid[])',
    'EXECUTE'
  ),
  'the API runtime can save an authorized draft'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'private.save_business_profile_draft(uuid,uuid,uuid,text,text,text,text,text,text[],text,text,text,text,text,uuid,uuid,uuid[])',
    'EXECUTE'
  ),
  'browser identities cannot call the write function directly'
);

create temporary table saved_profile on commit drop as
select *
from private.save_business_profile_draft(
  'd3000000-0000-4000-8000-000000000003',
  (select id from public.locations where tenant_id = 'd3000000-0000-4000-8000-000000000003'),
  'd1000000-0000-4000-8000-000000000001',
  'Bodegón Uno',
  '',
  '',
  '',
  '',
  array['es'],
  'visual',
  'serif',
  '#1F2937',
  '#F9FAFB',
  '#D97706',
  null,
  null,
  '{}'::uuid[]
);

select results_eq(
  $$ select display_name, revision from saved_profile $$,
  $$ values ('Bodegón Uno'::text, 1) $$,
  'an administrator saves an incomplete first draft'
);

select is(
  (
    select revision
    from private.save_business_profile_draft(
      'd3000000-0000-4000-8000-000000000003',
      (select id from public.locations where tenant_id = 'd3000000-0000-4000-8000-000000000003'),
      'd1000000-0000-4000-8000-000000000001',
      'Bodegón Uno', '', '', 'Nueva dirección', '', array['es', 'en'],
      'modern', 'sans', '#111827', '#FFFFFF', '#EA580C', null, null, '{}'::uuid[]
    )
  ),
  2,
  'saving again increments the draft revision'
);

select throws_ok(
  $$
    select *
    from private.get_business_profile_draft(
      'd3000000-0000-4000-8000-000000000003',
      (select id from public.locations where tenant_id = 'd3000000-0000-4000-8000-000000000003'),
      'd2000000-0000-4000-8000-000000000002'
    )
  $$,
  '42501',
  null,
  'an administrator from another tenant cannot read the draft'
);

select throws_ok(
  $$
    select *
    from private.save_business_profile_draft(
      'd3000000-0000-4000-8000-000000000003',
      (select id from public.locations where tenant_id = 'd3000000-0000-4000-8000-000000000003'),
      'd2000000-0000-4000-8000-000000000002',
      'Cross tenant', '', '', '', '', array['es'],
      'visual', 'serif', '#1F2937', '#F9FAFB', '#D97706', null, null, '{}'::uuid[]
    )
  $$,
  '42501',
  null,
  'an administrator from another tenant cannot overwrite the draft'
);

insert into private.published_business_profiles (
  tenant_id,
  location_id,
  source_revision,
  snapshot,
  published_by
) values (
  'd3000000-0000-4000-8000-000000000003',
  (select id from public.locations where tenant_id = 'd3000000-0000-4000-8000-000000000003'),
  1,
  '{"displayName":"Published name"}'::jsonb,
  'd1000000-0000-4000-8000-000000000001'
);

create temporary table latest_profile_save on commit drop as
select *
from private.save_business_profile_draft(
  'd3000000-0000-4000-8000-000000000003',
  (select id from public.locations where tenant_id = 'd3000000-0000-4000-8000-000000000003'),
  'd1000000-0000-4000-8000-000000000001',
  'Another draft name', '', '', '', '', array['es'],
  'compact', 'sans', '#111827', '#FFFFFF', '#EA580C', null, null, '{}'::uuid[]
);

select is(
  (
    select snapshot ->> 'displayName'
    from private.published_business_profiles
    where tenant_id = 'd3000000-0000-4000-8000-000000000003'
  ),
  'Published name',
  'saving a draft never changes the published snapshot'
);

select * from finish();
rollback;
