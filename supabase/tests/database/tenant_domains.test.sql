begin;

create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to authenticated;
set local search_path = public, extensions;

select plan(18);

select has_table('public', 'tenant_domains', 'tenant domains table exists');
select policies_are(
  'public',
  'tenant_domains',
  array['tenant_domains_select_member'],
  'tenant domain policies are explicit'
);
select has_function(
  'private',
  'resolve_tenant_by_hostname',
  array['text'],
  'hostname resolver exists'
);
select ok(
  has_function_privilege(
    'authenticator',
    'private.resolve_tenant_by_hostname(text)',
    'EXECUTE'
  ),
  'the API runtime can resolve a hostname'
);
select ok(
  not has_function_privilege(
    'anon',
    'private.resolve_tenant_by_hostname(text)',
    'EXECUTE'
  ),
  'anonymous browser clients cannot resolve through the private function'
);
select has_function(
  'private',
  'resolve_tenant_admin_by_hostname',
  array['text', 'uuid'],
  'the administrative hostname resolver exists'
);
select ok(
  has_function_privilege(
    'authenticator',
    'private.resolve_tenant_admin_by_hostname(text,uuid)',
    'EXECUTE'
  ),
  'the API runtime can resolve an administrative hostname'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'private.resolve_tenant_admin_by_hostname(text,uuid)',
    'EXECUTE'
  ),
  'browser identities cannot call the administrative resolver directly'
);

insert into auth.users (id)
values
  ('81000000-0000-4000-8000-000000000081'),
  ('82000000-0000-4000-8000-000000000082'),
  ('83000000-0000-4000-8000-000000000083');

insert into public.tenants (id, slug, name, status)
values
  ('a1000000-0000-4000-8000-000000000001', 'domain-active-a', 'Domain Active A', 'active'),
  ('a2000000-0000-4000-8000-000000000002', 'domain-active-b', 'Domain Active B', 'active'),
  ('a3000000-0000-4000-8000-000000000003', 'domain-draft', 'Domain Draft', 'draft');

insert into public.tenant_memberships (tenant_id, user_id, role)
values
  ('a1000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000081', 'admin'),
  ('a2000000-0000-4000-8000-000000000002', '82000000-0000-4000-8000-000000000082', 'admin'),
  ('a3000000-0000-4000-8000-000000000003', '83000000-0000-4000-8000-000000000083', 'admin');

insert into public.tenant_domains (tenant_id, hostname, kind, status, is_primary)
values
  ('a1000000-0000-4000-8000-000000000001', 'local-a.plataforma.test', 'platform_subdomain', 'active', true),
  ('a2000000-0000-4000-8000-000000000002', 'local-b.plataforma.test', 'platform_subdomain', 'active', true),
  ('a2000000-0000-4000-8000-000000000002', 'disabled.plataforma.test', 'custom', 'disabled', false),
  ('a3000000-0000-4000-8000-000000000003', 'draft.plataforma.test', 'platform_subdomain', 'active', true);

select results_eq(
  $$ select tenant_slug from private.resolve_tenant_by_hostname('local-a.plataforma.test') $$,
  $$ values ('domain-active-a'::text) $$,
  'an active hostname resolves exactly one active tenant'
);
select results_eq(
  $$ select tenant_slug from private.resolve_tenant_by_hostname('local-b.plataforma.test') $$,
  $$ values ('domain-active-b'::text) $$,
  'a second hostname resolves its own tenant without crossing contexts'
);
select is_empty(
  $$ select * from private.resolve_tenant_by_hostname('unknown.plataforma.test') $$,
  'an unknown hostname fails closed'
);
select is_empty(
  $$ select * from private.resolve_tenant_by_hostname('disabled.plataforma.test') $$,
  'a disabled hostname fails closed'
);
select is_empty(
  $$ select * from private.resolve_tenant_by_hostname('draft.plataforma.test') $$,
  'an active hostname cannot expose a draft tenant'
);
select results_eq(
  $$
    select tenant_slug
    from private.resolve_tenant_admin_by_hostname(
      'draft.plataforma.test',
      '83000000-0000-4000-8000-000000000083'
    )
  $$,
  $$ values ('domain-draft'::text) $$,
  'an assigned administrator can resolve its draft tenant'
);
select is_empty(
  $$
    select *
    from private.resolve_tenant_admin_by_hostname(
      'draft.plataforma.test',
      '81000000-0000-4000-8000-000000000081'
    )
  $$,
  'an administrator from another tenant cannot resolve the draft tenant'
);
select is_empty(
  $$ select * from private.resolve_tenant_by_hostname('local-a.plataforma.test.attacker.test') $$,
  'a hostname suffix cannot impersonate a configured domain'
);
select throws_ok(
  $$
    insert into public.tenant_domains (tenant_id, hostname, kind, status)
    values (
      'a1000000-0000-4000-8000-000000000001',
      'LOCAL-A.PLATAFORMA.TEST',
      'custom',
      'active'
    )
  $$,
  '23514',
  null,
  'stored hostnames must already be canonical'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '81000000-0000-4000-8000-000000000081',
  true
);

select extensions.results_eq(
  $$ select hostname from public.tenant_domains order by hostname $$::text,
  $$ values ('local-a.plataforma.test'::text) $$::text,
  'a tenant administrator can only inspect its own domains'
);

reset role;

select * from finish();
rollback;
