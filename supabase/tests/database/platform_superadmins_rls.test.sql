begin;

create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to anon, authenticated;
set local search_path = public, extensions;

select plan(7);

select has_table(
  'public',
  'platform_superadmins',
  'platform superadmins table exists'
);
select policies_are(
  'public',
  'platform_superadmins',
  array['platform_superadmins_select_self'],
  'platform superadmin policy is explicit'
);

insert into auth.users (id)
values
  ('40000000-0000-4000-8000-000000000004'),
  ('50000000-0000-4000-8000-000000000005');

insert into public.platform_superadmins (user_id)
values ('40000000-0000-4000-8000-000000000004');

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '40000000-0000-4000-8000-000000000004',
  true
);

select is(
  (select count(*)::integer from public.platform_superadmins),
  1,
  'a platform superadmin can read only its own assignment'
);
select throws_ok(
  $$ insert into public.platform_superadmins (user_id)
     values ('50000000-0000-4000-8000-000000000005') $$::text,
  '42501'::character(5),
  null::text,
  'an authenticated caller cannot grant platform access'::text
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '50000000-0000-4000-8000-000000000005',
  true
);

select is(
  (select count(*)::integer from public.platform_superadmins),
  0,
  'a regular identity cannot read the platform assignment'
);

reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);

select throws_ok(
  $$ select count(*) from public.platform_superadmins $$::text,
  '42501'::character(5),
  null::text,
  'an anonymous identity cannot read platform assignments'::text
);

reset role;
select is(
  (
    select count(*)::integer
    from public.platform_superadmins
    where user_id = '40000000-0000-4000-8000-000000000004'
  ),
  1,
  'the denied grant did not alter the platform assignment'
);

select * from finish();
rollback;
