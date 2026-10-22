begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(13);

select has_table(
  'private',
  'tenant_provisioning_requests',
  'provisioning requests are private'
);
select ok(
  has_function_privilege(
    'authenticator',
    'private.begin_tenant_provisioning(uuid,text,text,text,text,text)',
    'EXECUTE'
  ),
  'the API runtime can begin a bounded provisioning operation'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'private.begin_tenant_provisioning(uuid,text,text,text,text,text)',
    'EXECUTE'
  ),
  'tenant administrators cannot provision tenants'
);

insert into auth.users (id) values
  ('70000000-0000-4000-8000-000000000007'),
  ('71000000-0000-4000-8000-000000000071'),
  ('72000000-0000-4000-8000-000000000072');
insert into public.platform_superadmins (user_id)
values ('70000000-0000-4000-8000-000000000007');

select throws_ok(
  $$ select * from private.begin_tenant_provisioning(
    '71000000-0000-4000-8000-000000000071',
    repeat('a', 64), repeat('b', 64),
    'forbidden-business', 'Forbidden Business', 'owner@example.com'
  ) $$,
  '42501',
  'platform_superadmin_required',
  'a tenant user cannot provision a business'
);

select lives_ok(
  $$ select * from private.begin_tenant_provisioning(
    '70000000-0000-4000-8000-000000000007',
    repeat('c', 64), repeat('d', 64),
    'new-business', 'New Business', 'owner@example.com'
  ) $$,
  'a superadmin can provision a draft business'
);
select is(
  (select count(*)::integer from public.tenants where slug = 'new-business'),
  1,
  'the tenant is created once'
);
select is(
  (
    select count(*)::integer
    from public.locations location
    inner join public.tenants tenant on tenant.id = location.tenant_id
    where tenant.slug = 'new-business' and location.is_primary
  ),
  1,
  'the initial location is created once'
);

select lives_ok(
  $$ select * from private.begin_tenant_provisioning(
    '70000000-0000-4000-8000-000000000007',
    repeat('c', 64), repeat('d', 64),
    'new-business', 'New Business', 'owner@example.com'
  ) $$,
  'retrying the same request is idempotent'
);
select throws_ok(
  $$ select * from private.begin_tenant_provisioning(
    '70000000-0000-4000-8000-000000000007',
    repeat('c', 64), repeat('e', 64),
    'another-business', 'Another Business', 'other@example.com'
  ) $$,
  'P0001',
  'idempotency_conflict',
  'an idempotency key cannot be reused for another payload'
);

select throws_ok(
  $$ select * from private.complete_tenant_provisioning(
    '71000000-0000-4000-8000-000000000071',
    (
      select id from private.tenant_provisioning_requests
      where tenant_id = (select id from public.tenants where slug = 'new-business')
    ),
    '72000000-0000-4000-8000-000000000072'
  ) $$,
  '42501',
  'platform_superadmin_required',
  'another identity cannot complete the provisioning request'
);

select lives_ok(
  $$ select * from private.complete_tenant_provisioning(
    '70000000-0000-4000-8000-000000000007',
    (
      select id from private.tenant_provisioning_requests
      where tenant_id = (select id from public.tenants where slug = 'new-business')
    ),
    '72000000-0000-4000-8000-000000000072'
  ) $$,
  'the invited identity becomes tenant administrator'
);
select lives_ok(
  $$ select * from private.complete_tenant_provisioning(
    '70000000-0000-4000-8000-000000000007',
    (
      select id from private.tenant_provisioning_requests
      where tenant_id = (select id from public.tenants where slug = 'new-business')
    ),
    '72000000-0000-4000-8000-000000000072'
  ) $$,
  'retrying completion is idempotent'
);
select is(
  (
    select count(*)::integer
    from public.tenant_memberships membership
    inner join public.tenants tenant on tenant.id = membership.tenant_id
    where tenant.slug = 'new-business'
      and membership.user_id = '72000000-0000-4000-8000-000000000072'
  ),
  1,
  'completion creates one administrator membership'
);

select * from finish();
rollback;
