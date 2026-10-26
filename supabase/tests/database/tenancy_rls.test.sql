begin;

create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to authenticated;
set local search_path = public, extensions;

select plan(19);

select has_table('public', 'tenants', 'tenants table exists');
select has_table('public', 'locations', 'locations table exists');
select has_table('public', 'tenant_memberships', 'memberships table exists');
select policies_are(
  'public',
  'tenants',
  array['tenants_select_member', 'tenants_update_member'],
  'tenant policies are explicit'
);
select policies_are(
  'public',
  'locations',
  array[
    'locations_delete_member',
    'locations_insert_member',
    'locations_select_member',
    'locations_update_member'
  ],
  'location policies are explicit'
);
select policies_are(
  'public',
  'tenant_memberships',
  array['tenant_memberships_select_self'],
  'membership policy is explicit'
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

select is(
  (select count(*)::integer from public.locations
    where tenant_id in ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')),
  2,
  'each tenant receives an initial location'
);
select is(
  (
    select count(*)::integer
    from public.locations
    where is_primary
      and tenant_id in ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
  ),
  2,
  'each initial location is primary'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-0000-0000-000000000001',
  true
);

select results_eq(
  $$ select slug from public.tenants order by slug $$::text,
  $$ values ('tenant-a'::text) $$::text,
  'tenant A can only read its own tenant'
);
select is(
  (select count(*)::integer from public.locations),
  1,
  'tenant A can only read its own locations'
);
select is(
  (select count(*)::integer from public.tenant_memberships),
  1,
  'tenant A identity can only read its own membership'
);

select lives_ok(
  $$ update public.tenants set name = 'Tenant A actualizado' where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
  'tenant A can update its own tenant'
);
select is_empty(
  $$
    with updated as (
      update public.tenants
      set name = 'No permitido'
      where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
      returning 1
    )
    select * from updated
  $$,
  'tenant A cannot update tenant B'
);
select throws_ok(
  $$
    insert into public.locations (tenant_id, name)
    values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Intrusa')
  $$,
  '42501',
  null,
  'tenant A cannot insert a location for tenant B'
);
select lives_ok(
  $$
    insert into public.locations (tenant_id, name)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Patio')
  $$,
  'tenant A can add a non-primary location to its tenant'
);
select is_empty(
  $$
    with deleted as (
      delete from public.locations
      where tenant_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
        and is_primary
      returning 1
    )
    select * from deleted
  $$,
  'the primary location cannot be deleted by a tenant member'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '', true);

select is(
  (select count(*)::integer from public.tenants),
  0,
  'an unauthenticated identity cannot read tenants'
);
select is(
  (select count(*)::integer from public.locations),
  0,
  'an unauthenticated identity cannot read locations'
);
select is(
  (select count(*)::integer from public.tenant_memberships),
  0,
  'an unauthenticated identity cannot read memberships'
);

reset role;

select * from finish();
rollback;
