begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(21);

insert into auth.users (id)
values
  ('c1000000-0000-4000-8000-000000000001'),
  ('c2000000-0000-4000-8000-000000000002');

insert into public.platform_superadmins (user_id)
values ('c1000000-0000-4000-8000-000000000001');

insert into public.tenants (id, slug, name, status)
values
  (
    'c3000000-0000-4000-8000-000000000003',
    'commercial-suspension',
    'Commercial Suspension',
    'active'
  ),
  (
    'c4000000-0000-4000-8000-000000000004',
    'security-suspension',
    'Security Suspension',
    'active'
  ),
  (
    'c7000000-0000-4000-8000-000000000007',
    'draft-suspension',
    'Draft Suspension',
    'draft'
  );

insert into public.staff_members (
  id,
  tenant_id,
  location_id,
  username,
  display_name,
  role,
  created_by
)
select
  'c5000000-0000-4000-8000-000000000005',
  tenant.id,
  location.id,
  'security.waiter',
  'Security Waiter',
  'waiter',
  'c2000000-0000-4000-8000-000000000002'
from public.tenants tenant
inner join public.locations location
  on location.tenant_id = tenant.id
  and location.is_primary
where tenant.id = 'c4000000-0000-4000-8000-000000000004';

insert into private.staff_sessions (
  id,
  tenant_id,
  staff_member_id,
  token_hash,
  expires_at
)
values (
  'c6000000-0000-4000-8000-000000000006',
  'c4000000-0000-4000-8000-000000000004',
  'c5000000-0000-4000-8000-000000000005',
  repeat('a', 64),
  now() + interval '8 hours'
);

select has_table(
  'private',
  'tenant_suspensions',
  'suspension state is kept outside the tenant-visible schema'
);
select table_privs_are(
  'private',
  'tenant_suspensions',
  'authenticator',
  array[]::text[],
  'the API runtime cannot mutate suspension state directly'
);
select ok(
  has_function_privilege(
    'authenticator',
    'private.request_tenant_suspension(uuid,uuid,text,text,text)',
    'EXECUTE'
  ),
  'the API runtime can request suspension through the guarded function'
);
select ok(
  not has_function_privilege(
    'authenticator',
    'private.complete_commercial_suspension(uuid)',
    'EXECUTE'
  ),
  'the API cannot complete draining before the table-session trigger verifies it'
);

select throws_ok(
  $$
    select *
    from private.request_tenant_suspension(
      'c3000000-0000-4000-8000-000000000003',
      'c2000000-0000-4000-8000-000000000002',
      'commercial',
      'Unrelated user request',
      'suspension-unauthorized'
    )
  $$,
  '42501',
  null,
  'only a platform superadministrator can suspend a tenant'
);

select results_eq(
  $$
    select mode, phase, tenant_status
    from private.request_tenant_suspension(
      'c3000000-0000-4000-8000-000000000003',
      'c1000000-0000-4000-8000-000000000001',
      'commercial',
      'Subscription period ended',
      'suspension-commercial-001'
    )
  $$,
  $$ values ('commercial'::text, 'commercial_draining'::text, 'active'::text) $$,
  'commercial suspension begins in draining mode'
);
select is(
  (
    select status
    from public.tenants
    where id = 'c3000000-0000-4000-8000-000000000003'
  ),
  'active',
  'commercial draining keeps the tenant active for open tables'
);
select is(
  private.can_open_table_session(
    'c3000000-0000-4000-8000-000000000003'
  ),
  false,
  'commercial draining rejects new table sessions'
);
select is(
  (
    select count(*)::integer
    from private.audit_events
    where tenant_id = 'c3000000-0000-4000-8000-000000000003'
      and action = 'tenant.suspension_requested'
  ),
  1,
  'the commercial request is audited'
);

select lives_ok(
  $$
    select private.complete_commercial_suspension(
      'c3000000-0000-4000-8000-000000000003'
    )
  $$,
  'the trusted table-session lifecycle can complete draining'
);
select is(
  (
    select status
    from public.tenants
    where id = 'c3000000-0000-4000-8000-000000000003'
  ),
  'suspended',
  'commercial completion suspends the tenant after open tables close'
);
select results_eq(
  $$
    select phase, completed_at is not null
    from private.tenant_suspensions
    where tenant_id = 'c3000000-0000-4000-8000-000000000003'
  $$,
  $$ values ('suspended'::text, true) $$,
  'commercial completion records its terminal state'
);
select is(
  (
    select count(*)::integer
    from private.audit_events
    where tenant_id = 'c3000000-0000-4000-8000-000000000003'
      and action = 'tenant.suspension_completed'
  ),
  1,
  'commercial completion is audited'
);

select results_eq(
  $$
    select mode, phase, tenant_status
    from private.request_tenant_suspension(
      'c4000000-0000-4000-8000-000000000004',
      'c1000000-0000-4000-8000-000000000001',
      'security',
      'Compromised staff credentials',
      'suspension-security-001'
    )
  $$,
  $$ values ('security'::text, 'suspended'::text, 'suspended'::text) $$,
  'security suspension is immediate'
);
select is(
  (
    select status
    from public.tenants
    where id = 'c4000000-0000-4000-8000-000000000004'
  ),
  'suspended',
  'security suspension immediately changes tenant status'
);
select isnt(
  (
    select revoked_at
    from private.staff_sessions
    where id = 'c6000000-0000-4000-8000-000000000006'
  ),
  null,
  'security suspension revokes active staff sessions'
);
select is(
  private.can_open_table_session(
    'c4000000-0000-4000-8000-000000000004'
  ),
  false,
  'a security-suspended tenant cannot open table sessions'
);
select throws_ok(
  $$
    select *
    from private.request_tenant_suspension(
      'c4000000-0000-4000-8000-000000000004',
      'c1000000-0000-4000-8000-000000000001',
      'commercial',
      'Attempted suspension downgrade',
      'suspension-downgrade'
    )
  $$,
  '22023',
  null,
  'a terminal suspension cannot be downgraded into draining'
);
select throws_ok(
  $$
    select *
    from private.request_tenant_suspension(
      'c4000000-0000-4000-8000-000000000004',
      'c1000000-0000-4000-8000-000000000001',
      'maintenance',
      'Unsupported suspension mode',
      'suspension-invalid-mode'
    )
  $$,
  '22023',
  null,
  'unsupported suspension modes are rejected'
);

select results_eq(
  $$
    select mode, phase, tenant_status
    from private.request_tenant_suspension(
      'c7000000-0000-4000-8000-000000000007',
      'c1000000-0000-4000-8000-000000000001',
      'commercial',
      'Draft subscription was cancelled',
      'suspension-draft-001'
    )
  $$,
  $$ values ('commercial'::text, 'suspended'::text, 'suspended'::text) $$,
  'a draft commercial suspension completes without activating the tenant'
);
select is(
  (
    select count(*)::integer
    from private.audit_events
    where tenant_id = 'c7000000-0000-4000-8000-000000000007'
      and action = 'tenant.suspension_completed'
  ),
  1,
  'immediate draft completion is audited'
);

select * from finish();
rollback;
