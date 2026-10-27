begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(9);

-- Tenant isolation does not rest on one mechanism: tables in `public` have RLS, `private`
-- is closed by grants and reached only through functions that take the tenant explicitly.

select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity),
  0::bigint, 'every table in public has row level security');

select is(
  (select count(*) from information_schema.role_table_grants
   where table_schema = 'private' and grantee in ('anon', 'authenticated', 'PUBLIC')),
  0::bigint, 'no table of private is granted to anon, authenticated or PUBLIC');

select is(
  (select count(*) from information_schema.role_routine_grants
   where specific_schema = 'private' and routine_schema = 'private' and grantee = 'PUBLIC'),
  0::bigint, 'no function of private is executable by PUBLIC');

select is(
  (select coalesce(array_agg(p.proname order by p.proname), '{}')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private'
     and (has_function_privilege('anon', p.oid, 'execute')
       or has_function_privilege('authenticated', p.oid, 'execute'))),
  array['is_auth_session_active', 'is_tenant_member']::name[],
  'only the two helpers the RLS policies call are executable by signed-in users');

select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and p.prosecdef
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) setting
                     where setting like 'search_path=%')),
  0::bigint, 'every SECURITY DEFINER function pins its search_path');

select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')),
  0::bigint, 'anonymous visitors can execute nothing in public');

select is(
  (select count(*) from storage.buckets where public),
  0::bigint, 'no Storage bucket is public: files are served through signed addresses');

select is(
  (select count(*) from pg_policies
   where schemaname = 'realtime' and tablename = 'messages' and cmd in ('INSERT', 'ALL', 'UPDATE', 'DELETE')),
  0::bigint, 'nobody can write to a Realtime channel from a browser');

select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'private' and c.relkind = 'v'
     and has_table_privilege('authenticated', c.oid, 'select')),
  0::bigint, 'no view of private is readable by signed-in users');

select * from finish();
rollback;
