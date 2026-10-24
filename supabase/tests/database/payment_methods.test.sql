begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(24);

insert into auth.users (id)
values
  ('a1000000-0000-4000-8000-000000000001'),
  ('a2000000-0000-4000-8000-000000000002');

insert into public.tenants (id, slug, name, status)
values
  ('a3000000-0000-4000-8000-000000000003', 'pay-one', 'Pay One', 'draft'),
  ('a4000000-0000-4000-8000-000000000004', 'pay-two', 'Pay Two', 'draft');

insert into public.tenant_memberships (tenant_id, user_id, role)
values
  ('a3000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'admin'),
  ('a4000000-0000-4000-8000-000000000004', 'a2000000-0000-4000-8000-000000000002', 'admin');

create temporary table scope as
select
  'a3000000-0000-4000-8000-000000000003'::uuid as t1,
  (select id from public.locations where tenant_id = 'a3000000-0000-4000-8000-000000000003') as l1,
  'a4000000-0000-4000-8000-000000000004'::uuid as t2,
  (select id from public.locations where tenant_id = 'a4000000-0000-4000-8000-000000000004') as l2;

create function pg_temp.methods(which integer default 1)
returns jsonb language sql as $$
  select case which
    when 1 then private.read_payment_methods((select t1 from scope), (select l1 from scope), 'a1000000-0000-4000-8000-000000000001')
    else private.read_payment_methods((select t2 from scope), (select l2 from scope), 'a2000000-0000-4000-8000-000000000002')
  end
$$;

create function pg_temp.setm(method text, enabled boolean, config jsonb default null)
returns jsonb language sql as $$
  select private.update_payment_method(
    (select t1 from scope), (select l1 from scope), 'a1000000-0000-4000-8000-000000000001',
    method, enabled, config)
$$;

select has_table('private', 'payment_method_secrets', 'provider secrets live in a private table');
select table_privs_are('private', 'payment_method_secrets', 'authenticator', array[]::text[],
  'the runtime cannot read secrets directly');

select is((select e->>'enabled' from jsonb_array_elements(pg_temp.methods()) e where e->>'method' = 'cash'),
  'true', 'cash starts enabled');
select is((select count(*)::int from jsonb_array_elements(pg_temp.methods()) e where e->>'enabled' = 'true'),
  1, 'only cash starts enabled');

select throws_ok($$ select pg_temp.setm('cash', false) $$, 'PT004', null,
  'cash cannot be disabled while it is the only method');
select throws_ok($$ select pg_temp.setm('mercado_pago', true) $$, 'PT003', null,
  'a provider cannot be enabled before its credential is stored');

select lives_ok($$ select pg_temp.setm('debit_card', true) $$, 'an in-person method can be enabled');
select lives_ok($$ select pg_temp.setm('cash', false) $$, 'cash can be disabled once another method is available');
select throws_ok($$ select pg_temp.setm('debit_card', false) $$, 'PT004', null,
  'the last available method cannot be disabled');
select lives_ok($$ select pg_temp.setm('cash', true) $$, 'cash can be enabled again');

-- Direct writes cannot bypass the rule either.
select throws_ok($$
  update private.payment_methods set enabled = false
  where tenant_id = (select t1 from scope) and method_key in ('cash', 'debit_card');
  set constraints all immediate;
$$, 'PT004', null, 'the database rejects a location left without a method');

-- Provider credential.
select lives_ok($$ select private.store_payment_secret(
  (select t1 from scope), (select l1 from scope), 'a1000000-0000-4000-8000-000000000001',
  'mercado_pago', '\x000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20', 1::smallint) $$,
  'an encrypted credential can be stored');
select throws_ok($$ select private.store_payment_secret(
  (select t1 from scope), (select l1 from scope), 'a1000000-0000-4000-8000-000000000001',
  'cash', '\x000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20', 1::smallint) $$,
  '22023', null, 'only provider methods accept credentials');
select throws_ok($$ select pg_temp.setm('mercado_pago', true) $$, 'PT003', null,
  'a provider also needs its public key before it can be enabled');
select throws_ok($$ select pg_temp.setm('mercado_pago', false, '{"publicKey":"x y","secret":"1"}') $$, '22023', null,
  'public configuration rejects unknown keys and malformed values');
select lives_ok($$ select pg_temp.setm('mercado_pago', true, '{"publicKey":"APP_USR-abcdef123456"}') $$,
  'a configured provider can be enabled');

select is((select e->>'configured' from jsonb_array_elements(pg_temp.methods()) e where e->>'method' = 'mercado_pago'),
  'true', 'reads report that the credential exists');
select ok(position('\x' in pg_temp.methods()::text) = 0
  and pg_temp.methods()::text !~* 'ciphertext|secret"',
  'reads expose state only, never credential material');

select lives_ok($$ select private.clear_payment_secret(
  (select t1 from scope), (select l1 from scope), 'a1000000-0000-4000-8000-000000000001', 'mercado_pago') $$,
  'clearing a credential disables the provider');
select is((select e->>'enabled' from jsonb_array_elements(pg_temp.methods()) e where e->>'method' = 'mercado_pago'),
  'false', 'the provider is disabled after clearing');

-- Audit and isolation.
select ok((select count(*) from private.audit_events where tenant_id = (select t1 from scope)
  and action like 'payment_method.%') >= 6, 'changes are audited');
select is((select count(*)::int from private.audit_events where tenant_id = (select t1 from scope)
  and (reason || correlation_id) ~* '(APP_USR|abcdef|\\x0001)'), 0, 'audit rows hold no key or secret');
select is((select e->>'enabled' from jsonb_array_elements(pg_temp.methods(2)) e where e->>'method' = 'cash'),
  'true', 'the second tenant keeps its own defaults');
select throws_ok($$ select private.read_payment_methods((select t1 from scope), (select l1 from scope),
  'a2000000-0000-4000-8000-000000000002') $$, '42501', null,
  'another tenant administrator cannot read the methods');

select * from finish();
rollback;
