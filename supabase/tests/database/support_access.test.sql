begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(15);

insert into auth.users (id)
values
  ('b1000000-0000-4000-8000-000000000001'),
  ('b2000000-0000-4000-8000-000000000002'),
  ('b3000000-0000-4000-8000-000000000003');

insert into public.platform_superadmins (user_id)
values ('b1000000-0000-4000-8000-000000000001');

insert into public.tenants (id, slug, name, status)
values (
  'b4000000-0000-4000-8000-000000000004',
  'support-access',
  'Support Access',
  'active'
);

insert into public.tenant_memberships (tenant_id, user_id, role)
values (
  'b4000000-0000-4000-8000-000000000004',
  'b2000000-0000-4000-8000-000000000002',
  'admin'
);

select has_table(
  'private',
  'support_access_grants',
  'support authorization has a private grant table'
);
select table_privs_are(
  'private',
  'support_access_grants',
  'authenticator',
  array[]::text[],
  'the API runtime cannot bypass support grant functions'
);
select ok(
  has_function_privilege(
    'authenticator',
    'private.grant_support_access(uuid,uuid,uuid,text,integer,text)',
    'EXECUTE'
  ),
  'the API runtime can create a bounded support grant'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'private.grant_support_access(uuid,uuid,uuid,text,integer,text)',
    'EXECUTE'
  ),
  'browser identities cannot create support grants directly'
);

create temporary table granted_support_access on commit drop as
select *
from private.grant_support_access(
  'b4000000-0000-4000-8000-000000000004',
  'b1000000-0000-4000-8000-000000000001',
  'b2000000-0000-4000-8000-000000000002',
  'Diagnóstico solicitado por el Administrador',
  60,
  'request-support-001'
);

select results_eq(
  $$ select status, reason from granted_support_access $$,
  $$ values (
    'active'::text,
    'Diagnóstico solicitado por el Administrador'::text
  ) $$,
  'an administrator creates a visible active grant'
);
select is(
  (
    select count(*)::integer
    from private.audit_events
    where tenant_id = 'b4000000-0000-4000-8000-000000000004'
      and action = 'support_access.granted'
  ),
  1,
  'granting support is audited in the same transaction'
);
select results_eq(
  $$
    select status
    from private.list_support_access(
      'b4000000-0000-4000-8000-000000000004',
      'b2000000-0000-4000-8000-000000000002'
    )
  $$,
  $$ values ('active'::text) $$,
  'the tenant administrator can inspect the current grant'
);
select throws_ok(
  $$
    select *
    from private.list_support_access(
      'b4000000-0000-4000-8000-000000000004',
      'b3000000-0000-4000-8000-000000000003'
    )
  $$,
  '42501',
  null,
  'an unrelated identity cannot inspect support access'
);
select is(
  (
    select count(*)::integer
    from private.resolve_active_support_access(
      'b4000000-0000-4000-8000-000000000004',
      'b1000000-0000-4000-8000-000000000001'
    )
  ),
  1,
  'the authorized support identity resolves its active grant'
);
select is_empty(
  $$
    select *
    from private.resolve_active_support_access(
      'b4000000-0000-4000-8000-000000000004',
      'b3000000-0000-4000-8000-000000000003'
    )
  $$,
  'an unauthorized support identity resolves nothing'
);

select is(
  (
    select status
    from private.revoke_support_access(
      'b4000000-0000-4000-8000-000000000004',
      (select id from granted_support_access),
      'b2000000-0000-4000-8000-000000000002',
      'Diagnóstico finalizado',
      'request-support-002'
    )
  ),
  'revoked',
  'the administrator can revoke support immediately'
);
select is_empty(
  $$
    select *
    from private.resolve_active_support_access(
      'b4000000-0000-4000-8000-000000000004',
      'b1000000-0000-4000-8000-000000000001'
    )
  $$,
  'revoked support no longer resolves as active'
);
select is(
  (
    select count(*)::integer
    from private.audit_events
    where tenant_id = 'b4000000-0000-4000-8000-000000000004'
      and action = 'support_access.revoked'
  ),
  1,
  'revoking support is audited in the same transaction'
);
select throws_ok(
  $$
    select *
    from private.grant_support_access(
      'b4000000-0000-4000-8000-000000000004',
      'b1000000-0000-4000-8000-000000000001',
      'b2000000-0000-4000-8000-000000000002',
      'Intento de acceso demasiado extenso',
      241,
      'request-support-003'
    )
  $$,
  '22023',
  null,
  'support access cannot exceed four hours'
);
select results_eq(
  $$
    select status, count(*) over ()::integer
    from private.grant_support_access(
      'b4000000-0000-4000-8000-000000000004',
      'b1000000-0000-4000-8000-000000000001',
      'b2000000-0000-4000-8000-000000000002',
      'Nuevo diagnóstico autorizado',
      30,
      'request-support-004'
    )
  $$,
  $$ values ('active'::text, 1) $$,
  'a revoked pairing can be granted again without duplicate current rows'
);

select * from finish();
rollback;
