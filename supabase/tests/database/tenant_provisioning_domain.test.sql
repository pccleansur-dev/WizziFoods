begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(9);

insert into auth.users (id)
values
  ('83000000-0000-4000-8000-000000000083'),
  ('84000000-0000-4000-8000-000000000084');
insert into public.platform_superadmins (user_id)
values ('83000000-0000-4000-8000-000000000083');

select ok(
  has_function_privilege(
    'authenticator',
    'private.begin_tenant_provisioning_with_domain(uuid,text,text,text,text,text,text)',
    'EXECUTE'
  ),
  'the API runtime can provision a tenant with its platform domain'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'private.begin_tenant_provisioning_with_domain(uuid,text,text,text,text,text,text)',
    'EXECUTE'
  ),
  'browser identities cannot provision platform domains'
);

select * from private.begin_tenant_provisioning_with_domain(
  '83000000-0000-4000-8000-000000000083',
  repeat('3', 64),
  repeat('4', 64),
  'domain-provisioning',
  'Domain Provisioning',
  'domain-provisioning@example.com',
  'domain-provisioning.plataforma.test'
);

select is(
  (
    select count(*)::integer
    from public.tenant_domains domain
    inner join public.tenants tenant on tenant.id = domain.tenant_id
    where tenant.slug = 'domain-provisioning'
  ),
  1,
  'the initial platform domain is created once'
);
select results_eq(
  $$
    select domain.hostname, domain.kind, domain.status, domain.is_primary
    from public.tenant_domains domain
    inner join public.tenants tenant on tenant.id = domain.tenant_id
    where tenant.slug = 'domain-provisioning'
  $$::text,
  $$ values (
    'domain-provisioning.plataforma.test'::text,
    'platform_subdomain'::text,
    'active'::text,
    true
  ) $$::text,
  'the platform subdomain is active and primary'
);

select * from private.begin_tenant_provisioning_with_domain(
  '83000000-0000-4000-8000-000000000083',
  repeat('3', 64),
  repeat('4', 64),
  'domain-provisioning',
  'Domain Provisioning',
  'domain-provisioning@example.com',
  'domain-provisioning.plataforma.test'
);

select is(
  (
    select count(*)::integer
    from public.tenant_domains domain
    inner join public.tenants tenant on tenant.id = domain.tenant_id
    where tenant.slug = 'domain-provisioning'
  ),
  1,
  'an idempotent retry does not duplicate the domain'
);
select is(
  (
    select tenant_hostname
    from private.begin_tenant_provisioning_with_domain(
      '83000000-0000-4000-8000-000000000083',
      repeat('3', 64),
      repeat('4', 64),
      'domain-provisioning',
      'Domain Provisioning',
      'domain-provisioning@example.com',
      'changed-base.example.test'
    )
  ),
  'domain-provisioning.plataforma.test',
  'a retry reuses the assigned hostname if platform configuration changes'
);
select is_empty(
  $$
    select *
    from private.resolve_tenant_by_hostname(
      'domain-provisioning.plataforma.test'
    )
  $$,
  'the draft tenant is not publicly resolved before publication'
);
select is(
  (
    select count(*)::integer
    from public.locations location
    inner join public.tenants tenant on tenant.id = location.tenant_id
    where tenant.slug = 'domain-provisioning'
  ),
  1,
  'domain provisioning keeps one initial location'
);
select is(
  (
    select tenant_hostname
    from private.complete_tenant_provisioning_with_domain(
      '83000000-0000-4000-8000-000000000083',
      (
        select id
        from private.tenant_provisioning_requests
        where admin_email = 'domain-provisioning@example.com'
      ),
      '84000000-0000-4000-8000-000000000084'
    )
  ),
  'domain-provisioning.plataforma.test',
  'completion preserves the assigned hostname'
);

select * from finish();
rollback;
