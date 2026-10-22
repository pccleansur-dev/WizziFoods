begin;

create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to authenticated;
set local search_path = public, extensions;

select plan(11);

select has_table('public', 'staff_members', 'staff member table exists');
select has_table('private', 'staff_credentials', 'PIN credentials are private');
select has_table('private', 'staff_sessions', 'staff sessions are private');
select policies_are(
  'public',
  'staff_members',
  array[
    'staff_members_insert_tenant_admin',
    'staff_members_select_tenant_admin',
    'staff_members_update_tenant_admin'
  ],
  'staff member policies are explicit'
);

insert into auth.users (id)
values
  ('10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000002');

insert into public.tenants (id, slug, name)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'tenant-a', 'Tenant A'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'tenant-b', 'Tenant B');

insert into public.tenant_memberships (tenant_id, user_id, role)
values
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '10000000-0000-0000-0000-000000000001',
    'admin'
  ),
  (
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    '20000000-0000-0000-0000-000000000002',
    'admin'
  );

select set_config(
  'test.tenant_b_location',
  (
    select id::text
    from public.locations
    where tenant_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
  ),
  true
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-0000-0000-000000000001',
  true
);

select lives_ok(
  $$
    insert into public.staff_members (
      tenant_id,
      location_id,
      username,
      display_name,
      role,
      created_by
    )
    select
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      id,
      'ana.moza',
      'Ana',
      'waiter',
      '10000000-0000-0000-0000-000000000001'
    from public.locations
    where tenant_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  $$,
  'tenant A can create its own staff member'
);

select throws_ok(
  $$
    insert into public.staff_members (
      tenant_id,
      location_id,
      username,
      display_name,
      role,
      created_by
    )
    values (
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      current_setting('test.tenant_b_location')::uuid,
      'intruso',
      'Intruso',
      'waiter',
      '10000000-0000-0000-0000-000000000001'
    )
  $$,
  '42501',
  null,
  'tenant A cannot create staff in tenant B'
);

select is(
  (select count(*)::integer from public.staff_members),
  1,
  'tenant A only sees its own staff'
);

select throws_ok(
  $$ select * from private.staff_credentials $$,
  '42501',
  null,
  'authenticated users cannot read PIN credentials'
);

select throws_ok(
  $$ select * from private.staff_sessions $$,
  '42501',
  null,
  'authenticated users cannot read staff sessions'
);

select lives_ok(
  $$
    update public.staff_members
    set display_name = 'Ana Pérez', updated_at = now()
    where username = 'ana.moza'
  $$,
  'tenant A can update its own staff metadata'
);

reset role;

select is(
  (
    select display_name
    from public.staff_members
    where tenant_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  ),
  'Ana Pérez',
  'the authorized update was persisted'
);

select * from finish();
rollback;
