begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(37);

insert into auth.users (id) values ('1a100000-0000-4000-8000-000000000001');
insert into public.platform_superadmins (user_id) values ('1a100000-0000-4000-8000-000000000001');
insert into public.tenants (id, slug, name, status) values
  ('1a200000-0000-4000-8000-000000000001', 'dcall-one', 'Dcall One', 'active'),
  ('1a200000-0000-4000-8000-000000000002', 'dcall-two', 'Dcall Two', 'active');
insert into public.tenant_memberships (tenant_id, user_id, role)
values ('1a200000-0000-4000-8000-000000000001', '1a100000-0000-4000-8000-000000000001', 'admin');

create temporary table scope as select
  '1a200000-0000-4000-8000-000000000001'::uuid t1,
  (select id from public.locations where tenant_id = '1a200000-0000-4000-8000-000000000001') l1,
  '1a200000-0000-4000-8000-000000000002'::uuid t2,
  (select id from public.locations where tenant_id = '1a200000-0000-4000-8000-000000000002') l2;

-- Tables 1 and 2 are in sector S1 (waiter A); table 3 is in sector S2 (waiter B).
select private.save_floor_plan(
  (select t1 from scope), (select l1 from scope),
  '1a100000-0000-4000-8000-000000000001', '1a300000-0000-4000-8000-000000000001', 0,
  jsonb_build_object(
    'floors', jsonb_build_array(jsonb_build_object(
      'id','1a400000-0000-4000-8000-000000000001','name','Planta baja','position',0,'shortName',null)),
    'sectors', jsonb_build_array(
      jsonb_build_object('id','1a500000-0000-4000-8000-000000000001','name','Salón','position',0),
      jsonb_build_object('id','1a500000-0000-4000-8000-000000000002','name','Terraza','position',1)),
    'tables', (
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'label', t.label, 'sectorId', t.sector,
        'floorId','1a400000-0000-4000-8000-000000000001','shape','square',
        'x', t.x,'y',40,'width',100,'height',100,'rotation',0,'seatCount',4,
        'seatLayout','perimeter'))
      from (values
        ('1a600000-0000-4000-8000-000000000001','1','1a500000-0000-4000-8000-000000000001',40),
        ('1a600000-0000-4000-8000-000000000002','2','1a500000-0000-4000-8000-000000000001',200),
        ('1a600000-0000-4000-8000-000000000003','3','1a500000-0000-4000-8000-000000000002',360)
      ) as t(id, label, sector, x)),
    'groups', '[]'::jsonb));

create function pg_temp.member(username text, role text, sectors uuid[] default '{}')
returns uuid language sql as $$
  select (private.create_staff_member(
    (select t1 from scope), (select l1 from scope),
    '1a100000-0000-4000-8000-000000000001',
    username, initcap(username), role, 'scrypt-v1$c2FsdA$aGFzaA', sectors) ->> 'id')::uuid
$$;
create temporary table staff as select
  pg_temp.member('ana', 'waiter', array['1a500000-0000-4000-8000-000000000001'::uuid]) waiter_a,
  pg_temp.member('beto', 'waiter', array['1a500000-0000-4000-8000-000000000002'::uuid]) waiter_b,
  pg_temp.member('marta', 'manager') manager;

insert into private.location_publications (tenant_id, location_id, published_by)
values ((select t1 from scope), (select l1 from scope), '1a100000-0000-4000-8000-000000000001');

create function pg_temp.token(wanted_label text) returns text language sql as $$
  select qr.token from private.floor_table_qr_codes qr
  join private.floor_tables ft on ft.tenant_id = qr.tenant_id and ft.location_id = qr.location_id and ft.id = qr.table_id
  where ft.tenant_id = (select t1 from scope) and ft.label = wanted_label and qr.status = 'active'
$$;
create function pg_temp.call(table_label text, reason text) returns jsonb language sql as $$
  select private.create_waiter_call((select t1 from scope), (select l1 from scope), pg_temp.token(table_label), reason)
$$;
create function pg_temp.view(staff uuid) returns jsonb language sql as $$
  select private.waiter_salon_view((select t1 from scope), (select l1 from scope), staff)
$$;
create function pg_temp.claim(staff uuid, call uuid, command text) returns jsonb language sql as $$
  select private.claim_waiter_call((select t1 from scope), (select l1 from scope), staff, call, command::uuid)
$$;
create function pg_temp.resolve(staff uuid, call uuid, command text) returns jsonb language sql as $$
  select private.resolve_waiter_call((select t1 from scope), (select l1 from scope), staff, call, command::uuid)
$$;

-- Privileges ---------------------------------------------------------------
select ok(
  has_function_privilege('authenticator', 'private.create_waiter_call(uuid,uuid,text,text)', 'execute')
    and has_function_privilege('authenticator', 'private.resolve_waiter_call(uuid,uuid,uuid,uuid,uuid)', 'execute')
    and not has_function_privilege('anon', 'private.create_waiter_call(uuid,uuid,text,text)', 'execute'),
  'only the runtime role executes the new entry points');

-- Diner creates a call ------------------------------------------------------
create temporary table first_call as select pg_temp.call('1', 'call_waiter') result;
select is((select result ->> 'status' from first_call), 'open', 'a new call is open');
select is((select (result ->> 'created')::boolean from first_call), true, 'the first request creates the call');
select is((select count(*)::int from private.waiter_calls where reason = 'call_waiter'), 1, 'one call is stored');
select is(
  (select intent_id is null and payment_method is null from private.waiter_calls where reason = 'call_waiter'),
  true, 'a diner call has no intent and no payment method');

-- Idempotency ------------------------------------------------------------------
select is((pg_temp.call('1', 'call_waiter') ->> 'callId'), (select result ->> 'callId' from first_call),
  'asking again returns the same call');
select is((pg_temp.call('1', 'call_waiter') ->> 'created')::boolean, false, 'a repeated request reports it was not created');
select is((select count(*)::int from private.waiter_calls where reason = 'call_waiter'), 1, 'a repeated request never duplicates');
select isnt((pg_temp.call('1', 'help') ->> 'callId'), (select result ->> 'callId' from first_call),
  'another reason on the same table is another call');
select isnt((pg_temp.call('2', 'call_waiter') ->> 'callId'), (select result ->> 'callId' from first_call),
  'the same reason on another table is another call');

-- Validation ------------------------------------------------------------------------
select throws_ok($$ select pg_temp.call('1', 'order_validation') $$, 'PT120', null, 'a diner cannot create an order validation call');
select throws_ok($$ select pg_temp.call('1', 'pizza') $$, 'PT120', null, 'an unknown reason is refused');
select throws_ok($$ select pg_temp.call('1', null) $$, 'PT120', null, 'a missing reason is refused');
select throws_ok(
  $$ select private.create_waiter_call((select t1 from scope), (select l1 from scope), repeat('a', 64), 'help') $$,
  'PT101', null, 'an unknown token is refused');
select throws_ok(
  $$ select private.create_waiter_call((select t2 from scope), (select l2 from scope), pg_temp.token('1'), 'help') $$,
  'PT101', null, 'a token never resolves under another tenant');
select throws_ok($$ select pg_temp.call('1', 'request_bill') $$, 'PT121', null,
  'the bill needs an open table');

-- Service state and suspension ---------------------------------------------------------
insert into private.floor_table_service_states (tenant_id, location_id, table_id, state)
values ((select t1 from scope), (select l1 from scope), '1a600000-0000-4000-8000-000000000001', 'occupied');
select lives_ok($$ select pg_temp.call('1', 'request_bill') $$, 'an occupied table can ask for the bill');
select lives_ok($$ select pg_temp.call('2', 'help') $$, 'an available table can ask for help');

insert into private.tenant_suspensions (tenant_id, mode, phase, reason, requested_by, correlation_id, completed_at)
values ((select t1 from scope), 'security', 'suspended', 'prueba de suspension',
  '1a100000-0000-4000-8000-000000000001', 'dcall-test', now());
select throws_ok($$ select pg_temp.call('3', 'call_waiter') $$, 'PT102', null,
  'a suspended tenant takes no call from a table nobody is using');
select lives_ok($$ select pg_temp.call('1', 'help') $$, 'a suspended tenant still serves a seated table');
delete from private.tenant_suspensions where tenant_id = (select t1 from scope);

-- Salon view ----------------------------------------------------------------------------
select results_eq(
  $$ select c ->> 'reason' from jsonb_array_elements(pg_temp.view((select waiter_a from staff)) -> 'calls') c order by 1 $$,
  $$ values ('call_waiter'::text), ('call_waiter'), ('help'), ('help'), ('request_bill') $$,
  'the waiter sees every diner call of their sectors with its reason');
select ok(
  (select bool_and(c -> 'intentId' = 'null'::jsonb and c -> 'paymentMethod' = 'null'::jsonb)
   from jsonb_array_elements(pg_temp.view((select waiter_a from staff)) -> 'calls') c),
  'a diner call exposes no intent and no payment method');
select is(jsonb_array_length(pg_temp.view((select waiter_b from staff)) -> 'calls'), 0,
  'a waiter does not see calls outside their sectors');
select is(
  (select (u ->> 'openCalls')::int from jsonb_array_elements(pg_temp.view((select waiter_a from staff)) -> 'units') u where u ->> 'label' = 'Mesa 1'),
  3, 'the unit counts its diner calls');

-- Claim and resolve -------------------------------------------------------------------------
create temporary table help1 as select (pg_temp.call('1', 'help') ->> 'callId')::uuid id;
select is(pg_temp.claim((select waiter_a from staff), (select id from help1), '1a700000-0000-4000-8000-000000000001') ->> 'status',
  'acknowledged', 'the existing claim flow works on a diner call');
select is(pg_temp.call('1', 'help') ->> 'status', 'acknowledged',
  'asking again while it is being attended returns the attended call');
select throws_ok($$ select pg_temp.resolve((select waiter_b from staff), (select id from help1), '1a700000-0000-4000-8000-000000000002') $$,
  'PT201', null, 'a waiter outside the sector cannot resolve it');
select is(pg_temp.resolve((select manager from staff), (select id from help1), '1a700000-0000-4000-8000-000000000003') ->> 'status',
  'closed', 'a manager can resolve a call claimed by a waiter');
select is(pg_temp.resolve((select manager from staff), (select id from help1), '1a700000-0000-4000-8000-000000000003') ->> 'status',
  'closed', 'resolving replays its stored result');
select throws_ok($$ select pg_temp.resolve((select waiter_a from staff), (select id from help1), '1a700000-0000-4000-8000-000000000004') $$,
  'PT204', null, 'a resolved call cannot be resolved twice');
select ok(
  not exists (select 1 from jsonb_array_elements(pg_temp.view((select waiter_a from staff)) -> 'calls') c where c ->> 'id' = (select id::text from help1)),
  'a resolved call disappears from the salon view');
select is((select count(*)::int from private.audit_events where action = 'waiter_call.resolved' and subject_id = (select id from help1)), 1,
  'resolving is audited once');
select is((pg_temp.call('1', 'help') ->> 'created')::boolean, true, 'after being resolved the same reason can be asked again');
create temporary table other_call as select (pg_temp.call('2', 'call_waiter') ->> 'callId')::uuid id;
select is(pg_temp.resolve((select waiter_a from staff), (select id from other_call), '1a700000-0000-4000-8000-000000000005') ->> 'status',
  'closed', 'a waiter can resolve an open call without claiming it first');

-- Table shape -----------------------------------------------------------------------------------
select throws_ok(
  $$ insert into private.waiter_calls (tenant_id, location_id, table_id, reason, payment_method)
     values ((select t1 from scope), (select l1 from scope), '1a600000-0000-4000-8000-000000000001', 'order_validation', 'cash') $$,
  '23514', null, 'an order validation call cannot exist without an intent');
select throws_ok(
  $$ insert into private.waiter_calls (tenant_id, location_id, table_id, reason, payment_method)
     values ((select t1 from scope), (select l1 from scope), '1a600000-0000-4000-8000-000000000001', 'help', 'cash') $$,
  '23514', null, 'a diner call cannot carry a payment method');

-- Frequency limit ---------------------------------------------------------------------------------
select throws_ok($body$
  do $loop$ begin
    for i in 1..8 loop
      perform pg_temp.call('3', 'help');
      update private.waiter_calls set status = 'closed'
      where table_id = '1a600000-0000-4000-8000-000000000003' and status = 'open';
    end loop;
  end $loop$ $body$,
  'PT122', null, 'a table cannot flood the waiters with calls');

select * from finish();
rollback;
