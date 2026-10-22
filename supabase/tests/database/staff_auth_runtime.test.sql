begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(11);

select schema_privs_are(
  'private',
  'authenticator',
  array['USAGE'],
  'the API runtime can enter the private schema'
);
select table_privs_are(
  'private',
  'staff_credentials',
  'authenticator',
  array['INSERT', 'SELECT', 'UPDATE'],
  'the API runtime has bounded credential access'
);
select table_privs_are(
  'private',
  'staff_sessions',
  'authenticator',
  array['INSERT', 'SELECT', 'UPDATE'],
  'the API runtime has bounded session access'
);
select table_privs_are(
  'private',
  'staff_auth_events',
  'authenticator',
  array['INSERT'],
  'the API runtime can append but not rewrite audit events'
);
select table_privs_are(
  'private',
  'staff_credentials',
  'authenticated',
  array[]::text[],
  'a tenant administrator cannot read PIN hashes directly'
);
select ok(
  has_function_privilege(
    'authenticator',
    'private.resolve_active_staff_tenant(text)',
    'EXECUTE'
  ),
  'the API runtime can resolve an active tenant without bypassing RLS globally'
);
select ok(
  has_function_privilege(
    'authenticator',
    'private.lock_staff_login_candidate(uuid,text)',
    'EXECUTE'
  ),
  'the API runtime can lock one login candidate through a bounded function'
);
select ok(
  has_function_privilege(
    'authenticator',
    'private.resolve_staff_session(text)',
    'EXECUTE'
  ),
  'the API runtime can resolve one opaque staff session'
);
select ok(
  has_function_privilege(
    'authenticator',
    'private.lock_staff_revalidation_candidate(text)',
    'EXECUTE'
  ),
  'the API runtime can lock one revalidation candidate'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'private.resolve_staff_session(text)',
    'EXECUTE'
  ),
  'tenant administrators cannot resolve staff sessions'
);
select ok(
  not has_function_privilege(
    'anon',
    'private.lock_staff_revalidation_candidate(text)',
    'EXECUTE'
  ),
  'anonymous callers cannot inspect revalidation credentials'
);

select * from finish();
rollback;
