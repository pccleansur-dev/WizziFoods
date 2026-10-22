begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(5);

insert into auth.users (id) values
  ('76000000-0000-4000-8000-000000000076'),
  ('77000000-0000-4000-8000-000000000077');
insert into public.platform_superadmins (user_id)
values ('76000000-0000-4000-8000-000000000076');

select * from private.begin_tenant_provisioning(
  '76000000-0000-4000-8000-000000000076',
  repeat('1', 64), repeat('2', 64),
  'activation-business', 'Activation Business', 'activation@example.com'
);
select * from private.complete_tenant_provisioning(
  '76000000-0000-4000-8000-000000000076',
  (
    select id from private.tenant_provisioning_requests
    where admin_email = 'activation@example.com'
  ),
  '77000000-0000-4000-8000-000000000077'
);

select ok(
  has_function_privilege(
    'authenticator',
    'private.activate_tenant_provisioning(uuid)',
    'EXECUTE'
  ),
  'the API runtime can mark a completed invitation as activated'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'private.activate_tenant_provisioning(uuid)',
    'EXECUTE'
  ),
  'browser identities cannot mark invitations as activated'
);
select ok(
  private.activate_tenant_provisioning(
    '77000000-0000-4000-8000-000000000077'
  ),
  'the invited administrator activates after gaining access'
);
select ok(
  private.activate_tenant_provisioning(
    '77000000-0000-4000-8000-000000000077'
  ),
  'activation is idempotent'
);
select is(
  (
    select status
    from private.tenant_provisioning_requests
    where auth_user_id = '77000000-0000-4000-8000-000000000077'
  ),
  'activated',
  'the provisioning request records activation'
);

select * from finish();
rollback;
