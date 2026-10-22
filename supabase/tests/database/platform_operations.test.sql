begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(10);

insert into auth.users (id)
values
  ('d1000000-0000-4000-8000-000000000001'),
  ('d2000000-0000-4000-8000-000000000002');

insert into public.platform_superadmins (user_id)
values ('d1000000-0000-4000-8000-000000000001');

insert into public.tenants (id, slug, name, status)
values
  ('d3000000-0000-4000-8000-000000000003', 'alpha-operations', 'Alpha', 'active'),
  ('d4000000-0000-4000-8000-000000000004', 'beta-operations', 'Beta', 'draft');

select ok(
  has_function_privilege(
    'authenticator',
    'private.list_platform_tenants(uuid)',
    'EXECUTE'
  ),
  'the API runtime can list tenants through a guarded function'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'private.list_platform_tenants(uuid)',
    'EXECUTE'
  ),
  'browser identities cannot list all tenants directly'
);
select is(
  (
    select count(*)::integer
    from private.list_platform_tenants(
      'd1000000-0000-4000-8000-000000000001'
    )
  ),
  2,
  'the platform superadministrator sees every tenant'
);
select results_eq(
  $$
    select name, status, suspension_phase
    from private.list_platform_tenants(
      'd1000000-0000-4000-8000-000000000001'
    )
    order by name
  $$,
  $$ values
    ('Alpha'::text, 'active'::text, null::text),
    ('Beta'::text, 'draft'::text, null::text)
  $$,
  'the platform list exposes operational status without tenant content'
);
select throws_ok(
  $$
    select *
    from private.list_platform_tenants(
      'd2000000-0000-4000-8000-000000000002'
    )
  $$,
  '42501',
  null,
  'an unrelated identity cannot list tenants'
);

select private.append_audit_event(
  'd3000000-0000-4000-8000-000000000003',
  'platform_superadmin',
  'd1000000-0000-4000-8000-000000000001',
  'tenant.test_event',
  'Operational history test',
  'platform-operations-001',
  'tenant',
  'd3000000-0000-4000-8000-000000000003'
);

select ok(
  has_function_privilege(
    'authenticator',
    'private.list_platform_audit_events(uuid,integer)',
    'EXECUTE'
  ),
  'the API runtime can read bounded platform history'
);
select is(
  (
    select count(*)::integer
    from private.list_platform_audit_events(
      'd1000000-0000-4000-8000-000000000001',
      20
    )
    where tenant_id = 'd3000000-0000-4000-8000-000000000003'
      and action = 'tenant.test_event'
  ),
  1,
  'the superadministrator can inspect the platform audit trail'
);
select throws_ok(
  $$
    select *
    from private.list_platform_audit_events(
      'd2000000-0000-4000-8000-000000000002',
      20
    )
  $$,
  '42501',
  null,
  'an unrelated identity cannot inspect platform history'
);
select throws_ok(
  $$
    select *
    from private.list_platform_audit_events(
      'd1000000-0000-4000-8000-000000000001',
      101
    )
  $$,
  '22023',
  null,
  'platform history has a bounded page size'
);
select is(
  (
    select reason
    from private.list_platform_audit_events(
      'd1000000-0000-4000-8000-000000000001',
      20
    )
    where action = 'tenant.test_event'
  ),
  'Operational history test',
  'history exposes the required reason without unrelated payloads'
);

select * from finish();
rollback;
