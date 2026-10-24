begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(71);

insert into auth.users (id) values ('19100000-0000-4000-8000-000000000001'), ('19100000-0000-4000-8000-000000000002');
insert into public.tenants (id, slug, name, status) values
  ('19200000-0000-4000-8000-000000000001', 'waiter-one', 'Waiter One', 'active'),
  ('19200000-0000-4000-8000-000000000002', 'waiter-two', 'Waiter Two', 'active');
insert into public.tenant_memberships (tenant_id, user_id, role)
values ('19200000-0000-4000-8000-000000000001', '19100000-0000-4000-8000-000000000001', 'admin'),
  ('19200000-0000-4000-8000-000000000002', '19100000-0000-4000-8000-000000000002', 'admin');

create temporary table scope as select
  '19200000-0000-4000-8000-000000000001'::uuid t1,
  (select id from public.locations where tenant_id = '19200000-0000-4000-8000-000000000001') l1,
  '19200000-0000-4000-8000-000000000002'::uuid t2,
  (select id from public.locations where tenant_id = '19200000-0000-4000-8000-000000000002') l2;

-- Salon: sector S1 holds tables 1 and 2, sector S2 holds tables 3 and 4.
-- Tables 2 and 3 are grouped, so the group spans both sectors.
select private.save_floor_plan(
  (select t1 from scope), (select l1 from scope),
  '19100000-0000-4000-8000-000000000001',
  '19300000-0000-4000-8000-000000000001', 0,
  jsonb_build_object(
    'floors', jsonb_build_array(jsonb_build_object(
      'id','19400000-0000-4000-8000-000000000001','name','Planta baja','position',0,'shortName',null)),
    'sectors', jsonb_build_array(
      jsonb_build_object('id','19500000-0000-4000-8000-000000000001','name','Salón','position',0),
      jsonb_build_object('id','19500000-0000-4000-8000-000000000002','name','Terraza','position',1)),
    'tables', (
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'label', t.label, 'sectorId', t.sector,
        'floorId','19400000-0000-4000-8000-000000000001','shape','square',
        'x', t.x,'y',40,'width',100,'height',100,'rotation',0,'seatCount',4,
        'seatLayout','perimeter'))
      from (values
        ('19600000-0000-4000-8000-000000000001','1','19500000-0000-4000-8000-000000000001',40),
        ('19600000-0000-4000-8000-000000000002','2','19500000-0000-4000-8000-000000000001',200),
        ('19600000-0000-4000-8000-000000000003','3','19500000-0000-4000-8000-000000000002',360),
        ('19600000-0000-4000-8000-000000000004','4','19500000-0000-4000-8000-000000000002',520)
      ) as t(id, label, sector, x)),
    'groups', '[]'::jsonb
  )
);
insert into private.floor_groups (tenant_id, location_id, id, name, position)
values ((select t1 from scope), (select l1 from scope), '19700000-0000-4000-8000-000000000001', 'Cumpleaños', 0);
insert into private.floor_group_members (tenant_id, location_id, group_id, table_id, position)
values
  ((select t1 from scope), (select l1 from scope), '19700000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000002', 0),
  ((select t1 from scope), (select l1 from scope), '19700000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000003', 1);

-- The second tenant has its own plan and waiter.
select private.save_floor_plan(
  (select t2 from scope), (select l2 from scope),
  '19100000-0000-4000-8000-000000000002', '19300000-0000-4000-8000-000000000002', 0,
  jsonb_build_object(
    'floors', jsonb_build_array(jsonb_build_object(
      'id','19400000-0000-4000-8000-000000000002','name','Planta baja','position',0,'shortName',null)),
    'sectors', jsonb_build_array(jsonb_build_object(
      'id','19500000-0000-4000-8000-000000000003','name','Salón','position',0)),
    'tables', jsonb_build_array(jsonb_build_object(
      'id','19600000-0000-4000-8000-000000000005','label','1',
      'sectorId','19500000-0000-4000-8000-000000000003',
      'floorId','19400000-0000-4000-8000-000000000002','shape','square','x',40,'y',40,
      'width',100,'height',100,'rotation',0,'seatCount',4,'seatLayout','perimeter')),
    'groups', '[]'::jsonb
  )
);

create function pg_temp.member(username text, role text, sectors uuid[] default '{}')
returns uuid language sql as $$
  select (private.create_staff_member(
    (select t1 from scope), (select l1 from scope),
    '19100000-0000-4000-8000-000000000001',
    username, initcap(username), role, 'scrypt-v1$c2FsdA$aGFzaA', sectors) ->> 'id')::uuid
$$;

create temporary table staff as select
  pg_temp.member('ana', 'waiter', array['19500000-0000-4000-8000-000000000001'::uuid]) waiter_a,
  pg_temp.member('beto', 'waiter', array['19500000-0000-4000-8000-000000000002'::uuid]) waiter_b,
  pg_temp.member('carla', 'waiter') waiter_c,
  pg_temp.member('marta', 'manager') manager,
  pg_temp.member('coco', 'kitchen') kitchen;
-- A staff member of the second tenant.
insert into public.staff_members (id, tenant_id, location_id, username, display_name, role, created_by)
values ('19800000-0000-4000-8000-000000000001', (select t2 from scope), (select l2 from scope),
  'otra', 'Otra', 'waiter', '19100000-0000-4000-8000-000000000001');

insert into private.location_publications (tenant_id, location_id, published_by)
values ((select t1 from scope), (select l1 from scope), '19100000-0000-4000-8000-000000000001');

create function pg_temp.publish(revision integer, price integer)
returns void language sql as $$
  insert into private.published_catalogs (
    tenant_id, location_id, revision, source_draft_revision, snapshot, published_by
  ) values (
    (select t1 from scope), (select l1 from scope), revision, revision,
    jsonb_build_object(
      'baseRevision', null,
      'categories', jsonb_build_array(jsonb_build_object(
        'id','19a00000-0000-4000-8000-000000000001','position',0,
        'content',jsonb_build_array(jsonb_build_object('language','es','title','Platos','description','')))),
      'sectors', jsonb_build_array(jsonb_build_object(
        'id','19a00000-0000-4000-8000-000000000002','position',0,'name','Cocina','kind','kitchen')),
      'products', jsonb_build_array(jsonb_build_object(
        'id','19b00000-0000-4000-8000-000000000001','categoryId','19a00000-0000-4000-8000-000000000001',
        'sectorId','19a00000-0000-4000-8000-000000000002','position',0,'priceCents',price,
        'imageAssetId',null,
        'content',jsonb_build_array(jsonb_build_object('language','es','title','Milanesa','description','Con papas')),
        'variants',jsonb_build_array(jsonb_build_object(
          'id','19b00000-0000-4000-8000-000000000002','position',0,'priceDeltaCents',2500,
          'content',jsonb_build_array(jsonb_build_object('language','es','title','Napolitana','description',''))))))),
    '19100000-0000-4000-8000-000000000001')
$$;
select pg_temp.publish(1, 12500);
select private.ensure_payment_methods((select t1 from scope), (select l1 from scope));

create function pg_temp.token(wanted_label text) returns text language sql as $$
  select qr.token from private.floor_table_qr_codes qr
  join private.floor_tables ft on ft.tenant_id = qr.tenant_id and ft.location_id = qr.location_id and ft.id = qr.table_id
  where ft.tenant_id = (select t1 from scope) and ft.label = wanted_label and qr.status = 'active'
$$;
create function pg_temp.items(quantity integer default 2, variant boolean default true, line text default '19c00000-0000-4000-8000-000000000001')
returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object(
    'lineId', line, 'productId', '19b00000-0000-4000-8000-000000000001',
    'variantId', case when variant then to_jsonb('19b00000-0000-4000-8000-000000000002'::text) else 'null'::jsonb end,
    'quantity', quantity))
$$;
create function pg_temp.intent(table_label text, command text, method text default 'cash',
  path text default 'in_person', quantity integer default 2)
returns jsonb language sql as $$
  select private.create_order_intent(
    (select t1 from scope), (select l1 from scope), pg_temp.token(table_label),
    command::uuid, 'table', 'Valentín', null, method, path, pg_temp.items(quantity))
$$;
create function pg_temp.view(staff uuid) returns jsonb language sql as $$
  select private.waiter_salon_view((select t1 from scope), (select l1 from scope), staff)
$$;
create function pg_temp.claim(staff uuid, call uuid, command text) returns jsonb language sql as $$
  select private.claim_waiter_call((select t1 from scope), (select l1 from scope), staff, call, command::uuid)
$$;
create function pg_temp.decide(staff uuid, intent uuid, command text, decision text, reason text default null)
returns jsonb language sql as $$
  select private.decide_order_intent((select t1 from scope), (select l1 from scope), staff, intent, command::uuid, decision, reason)
$$;
create function pg_temp.manual(staff uuid, table_id text, command text, attribution text default 'table',
  name text default null, seat text default null, items jsonb default pg_temp.items(1, false, '19c00000-0000-4000-8000-000000000009'))
returns jsonb language sql as $$
  select private.create_manual_order((select t1 from scope), (select l1 from scope), staff,
    command::uuid, table_id::uuid, attribution, name, seat, items)
$$;

-- Privileges ---------------------------------------------------------------
select ok(
  not has_table_privilege('authenticator', 'private.confirmed_orders', 'select')
    and not has_table_privilege('authenticator', 'private.confirmed_order_items', 'insert')
    and not has_table_privilege('authenticator', 'private.waiter_commands', 'select')
    and not has_table_privilege('authenticator', 'private.order_intent_decisions', 'insert'),
  'the runtime role cannot touch the T19 tables directly');
select ok(
  has_function_privilege('authenticator', 'private.waiter_salon_view(uuid,uuid,uuid)', 'execute')
    and has_function_privilege('authenticator', 'private.claim_waiter_call(uuid,uuid,uuid,uuid,uuid)', 'execute')
    and has_function_privilege('authenticator', 'private.decide_order_intent(uuid,uuid,uuid,uuid,uuid,text,text)', 'execute')
    and has_function_privilege('authenticator', 'private.create_manual_order(uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb)', 'execute'),
  'the runtime role executes the four scoped entry points');
select ok(
  not has_function_privilege('authenticator', 'private.append_confirmed_order(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb)', 'execute')
    and not has_function_privilege('authenticator', 'private.quote_and_reserve_lines(uuid,uuid,jsonb,boolean)', 'execute')
    and not has_function_privilege('authenticator', 'private.waiter_actor_role(uuid,uuid,uuid)', 'execute'),
  'internal helpers are not reachable by the runtime role');

-- Authorization -----------------------------------------------------------
select throws_ok($$ select pg_temp.view((select kitchen from staff)) $$, 'PT200', null,
  'kitchen staff cannot read the salon view');
select throws_ok($$ select pg_temp.view('19800000-0000-4000-8000-000000000001') $$, 'PT200', null,
  'staff of another tenant cannot read this salon');
update public.staff_members set is_active = false where id = (select waiter_c from staff);
select throws_ok($$ select pg_temp.view((select waiter_c from staff)) $$, 'PT200', null,
  'an inactive staff member cannot operate');
update public.staff_members set is_active = true where id = (select waiter_c from staff);

-- Live view and scope -------------------------------------------------------
create temporary table intent1 as select pg_temp.intent('1', '19d00000-0000-4000-8000-000000000001') result;
create temporary table intent3 as select pg_temp.intent('3', '19d00000-0000-4000-8000-000000000002') result;

select results_eq(
  $$ select u ->> 'label', u ->> 'kind' from jsonb_array_elements(pg_temp.view((select waiter_a from staff)) -> 'units') u order by 1 $$,
  $$ values ('Mesa 1'::text, 'table'::text), ('Mesas 2 + 3', 'group') $$,
  'a waiter sees their tables and the group as one unit, never other tables');
select results_eq(
  $$ select t ->> 'label', (t ->> 'inScope')::boolean
     from jsonb_array_elements(pg_temp.view((select waiter_a from staff)) -> 'units') u,
       jsonb_array_elements(u -> 'tables') t where u ->> 'kind' = 'group' order by 1 $$,
  $$ values ('2'::text, true), ('3', false) $$,
  'a group member outside the waiter sectors is marked out of scope');
select is(jsonb_array_length(pg_temp.view((select waiter_c from staff)) -> 'units'), 0,
  'a waiter without sectors has no tables');
select is(jsonb_array_length(pg_temp.view((select manager from staff)) -> 'units'), 3,
  'a manager sees every active unit of the location');
select results_eq(
  $$ select c ->> 'tableLabel' from jsonb_array_elements(pg_temp.view((select waiter_a from staff)) -> 'calls') c $$,
  $$ values ('1'::text) $$,
  'a waiter only sees the calls of their own tables');
select results_eq(
  $$ select c ->> 'tableLabel' from jsonb_array_elements(pg_temp.view((select waiter_b from staff)) -> 'calls') c $$,
  $$ values ('3'::text) $$,
  'the other waiter sees only their own call even inside a shared group');
select results_eq(
  $$ select (u ->> 'openCalls')::int, (u ->> 'pendingIntents')::int, u -> 'session', u -> 'balanceCents'
     from jsonb_array_elements(pg_temp.view((select waiter_b from staff)) -> 'units') u where u ->> 'kind' = 'group' $$,
  $$ values (1, 1, 'null'::jsonb, 'null'::jsonb) $$,
  'the group counts its calls and exposes no session or balance yet');
select is(
  (select jsonb_array_length(i -> 'items') from jsonb_array_elements(pg_temp.view((select waiter_a from staff)) -> 'intents') i),
  1, 'a pending intent shows its server-priced items');
select is((select count(*)::int from private.floor_table_service_states), 0,
  'reading the salon never writes table state');

-- Claiming a call -----------------------------------------------------------
create temporary table call1 as select (result ->> 'callId')::uuid id from intent1;
create temporary table claim1 as select pg_temp.claim((select waiter_a from staff), (select id from call1), '19e00000-0000-4000-8000-000000000001') result;
select is((select result ->> 'status' from claim1), 'acknowledged', 'a waiter claims an open call');
select is(pg_temp.claim((select waiter_a from staff), (select id from call1), '19e00000-0000-4000-8000-000000000001'), (select result from claim1),
  'the same command replays its stored result');
select lives_ok($$ select pg_temp.claim((select waiter_a from staff), (select id from call1), '19e00000-0000-4000-8000-000000000002') $$,
  'claiming your own call again is idempotent');
select throws_ok($$ select pg_temp.claim((select manager from staff), (select id from call1), '19e00000-0000-4000-8000-000000000003') $$,
  'PT203', null, 'a call claimed by one waiter cannot be claimed by another');
select throws_ok($$ select pg_temp.claim((select waiter_b from staff), (select id from call1), '19e00000-0000-4000-8000-000000000004') $$,
  'PT201', null, 'a waiter cannot claim a call outside their sectors');
select throws_ok($$ select pg_temp.claim((select waiter_a from staff), '19f00000-0000-4000-8000-000000000000', '19e00000-0000-4000-8000-000000000005') $$,
  'PT201', null, 'an unknown call is not found');
select throws_ok(
  $$ select private.claim_waiter_call((select t2 from scope), (select l2 from scope), '19800000-0000-4000-8000-000000000001', (select id from call1), '19e00000-0000-4000-8000-000000000006') $$,
  'PT201', null, 'a call never crosses tenant scope');
select throws_ok($$ select pg_temp.claim((select waiter_a from staff), (select (result ->> 'callId')::uuid from intent3), '19e00000-0000-4000-8000-000000000001') $$,
  'PT100', null, 'a command id cannot be reused for another call');
select is((select status from private.waiter_calls where id = (select id from call1)), 'acknowledged',
  'the call is acknowledged exactly once');
select is((select count(*)::int from private.audit_events where action = 'waiter_call.claimed' and subject_id = (select id from call1)), 1,
  'claiming is audited once');

-- Rejecting and confirming an intent ----------------------------------------
select throws_ok(
  $$ select pg_temp.decide((select waiter_a from staff), (select (result ->> 'intentId')::uuid from intent1), '19e10000-0000-4000-8000-000000000001', 'reject', null) $$,
  'PT212', null, 'rejecting requires a reason');
create temporary table rejected as
select pg_temp.decide((select waiter_a from staff), (select (result ->> 'intentId')::uuid from intent1), '19e10000-0000-4000-8000-000000000002', 'reject', 'Cambiaron el pedido') result;
select is((select result ->> 'decision' from rejected), 'rejected', 'a waiter rejects their intent');
select results_eq(
  $$ select status from private.order_intents where id = (select (result ->> 'intentId')::uuid from intent1) $$,
  $$ values ('rejected'::text) $$, 'the intent is rejected');
select is((select status from private.waiter_calls where id = (select id from call1)), 'cancelled',
  'rejecting cancels the call');
select is((select count(*)::int from private.confirmed_orders), 0, 'rejecting never creates an order');
select is(pg_temp.decide((select waiter_a from staff), (select (result ->> 'intentId')::uuid from intent1), '19e10000-0000-4000-8000-000000000002', 'reject', 'Cambiaron el pedido'),
  (select result from rejected), 'rejecting again with the same command replays the result');
select throws_ok(
  $$ select pg_temp.decide((select manager from staff), (select (result ->> 'intentId')::uuid from intent1), '19e10000-0000-4000-8000-000000000003', 'confirm') $$,
  'PT205', null, 'a decided intent cannot be decided again');
select is((select count(*)::int from private.audit_events where action = 'order_intent.rejected'), 1,
  'the rejection is audited without its free-text reason');
select ok(not exists (select 1 from private.audit_events where reason like '%Cambiaron%'),
  'audit events do not echo the free-text reason');

create temporary table intent1b as select pg_temp.intent('1', '19d00000-0000-4000-8000-000000000003') result;
select throws_ok(
  $$ select pg_temp.decide((select waiter_b from staff), (select (result ->> 'intentId')::uuid from intent1b), '19e10000-0000-4000-8000-000000000004', 'confirm') $$,
  'PT201', null, 'a waiter cannot decide an intent of another sector');
select throws_ok(
  $$ select private.decide_order_intent((select t2 from scope), (select l2 from scope), '19800000-0000-4000-8000-000000000001', (select (result ->> 'intentId')::uuid from intent1b), '19e10000-0000-4000-8000-000000000005', 'confirm', null) $$,
  'PT201', null, 'an intent never crosses tenant scope');

create temporary table confirmed as
select pg_temp.decide((select waiter_a from staff), (select (result ->> 'intentId')::uuid from intent1b), '19e10000-0000-4000-8000-000000000006', 'confirm') result;
select is((select result ->> 'decision' from confirmed), 'confirmed', 'a waiter confirms their intent');
select results_eq(
  $$ select result #>> '{order,payment,state}', result #>> '{order,accountDecision}', (result #>> '{order,totalCents}')::int from confirmed $$,
  $$ values ('not_recorded'::text, 'pending'::text, 30000) $$,
  'confirming leaves payment unrecorded and the account decision pending');
select is((select count(*)::int from private.confirmed_orders), 1, 'one append-only order exists');
select is((select count(*)::int from private.confirmed_order_items), 1, 'its items were copied');
select is((select status from private.waiter_calls where intent_id = (select (result ->> 'intentId')::uuid from intent1b)), 'closed',
  'confirming closes the call');
select is(pg_temp.decide((select waiter_a from staff), (select (result ->> 'intentId')::uuid from intent1b), '19e10000-0000-4000-8000-000000000006', 'confirm'),
  (select result from confirmed), 'confirming again with the same command replays the result');
select is((select count(*)::int from private.confirmed_orders), 1, 'a replay never duplicates the order');
select is((select count(*)::int from private.floor_table_service_states where state = 'occupied'), 1,
  'confirming opens the table session and marks the table occupied (T22)');

-- Mercado Pago can never be confirmed by staff ------------------------------
update private.payment_methods set enabled = true, public_config = '{"publicKey":"TEST_PUBLIC_KEY"}'
where tenant_id = (select t1 from scope) and location_id = (select l1 from scope) and method_key = 'mercado_pago';
insert into private.payment_method_secrets (tenant_id, location_id, method_key, ciphertext, key_version)
values ((select t1 from scope), (select l1 from scope), 'mercado_pago', decode(repeat('ab', 29), 'hex'), 1);
create temporary table online as select pg_temp.intent('1', '19d00000-0000-4000-8000-000000000004', 'mercado_pago', 'online') result;
select throws_ok(
  $$ select pg_temp.decide((select manager from staff), (select (result ->> 'intentId')::uuid from online), '19e10000-0000-4000-8000-000000000007', 'confirm') $$,
  'PT207', null, 'a pending online payment is not confirmable by staff');
select throws_ok(
  $$ update private.order_intents set status = 'confirmed' where id = (select (result ->> 'intentId')::uuid from online) $$,
  'PT209', null, 'the table itself refuses to confirm an online intent');
select ok(exists (
  select 1 from pg_constraint
  where conrelid = 'private.order_intents'::regclass and conname = 'order_intents_status_path_check'),
  'a constraint also keeps online intents out of the confirmed states');
select ok(not exists (
  select 1 from jsonb_array_elements(pg_temp.view((select manager from staff)) -> 'intents') i
  where i ->> 'id' = (select result ->> 'intentId' from online)),
  'the salon view never lists a pending online payment');

-- Append-only ------------------------------------------------------------------
select throws_ok($$ update private.confirmed_orders set total_cents = 1 $$, 'PT209', null,
  'confirmed orders cannot be updated');
select throws_ok($$ delete from private.confirmed_order_items $$, 'PT209', null,
  'confirmed items cannot be deleted');
select throws_ok($$ truncate private.confirmed_orders cascade $$, 'PT209', null,
  'confirmed orders cannot be truncated');
select throws_ok($$ update private.order_intents set total_cents = 1 where id = (select (result ->> 'intentId')::uuid from intent3) $$,
  'PT209', null, 'an intent keeps its content: only the one-time decision may change');

-- Revalidation and stock ------------------------------------------------------
insert into private.product_operational_stock (tenant_id, location_id, product_id, available_quantity)
values ((select t1 from scope), (select l1 from scope), '19b00000-0000-4000-8000-000000000001', 3);
create temporary table stock_a as select pg_temp.intent('1', '19d00000-0000-4000-8000-000000000005', quantity => 2) result;
create temporary table stock_b as select pg_temp.intent('1', '19d00000-0000-4000-8000-000000000006', quantity => 2) result;
select lives_ok($$ select pg_temp.decide((select waiter_a from staff), (select (result ->> 'intentId')::uuid from stock_a), '19e10000-0000-4000-8000-000000000008', 'confirm') $$,
  'confirming decrements operational stock');
select is((select available_quantity from private.product_operational_stock), 1, 'stock was decremented atomically');
select throws_ok($$ select pg_temp.decide((select waiter_a from staff), (select (result ->> 'intentId')::uuid from stock_b), '19e10000-0000-4000-8000-000000000009', 'confirm') $$,
  'PT206', null, 'confirmation refuses when stock no longer covers the order');
select is((select available_quantity from private.product_operational_stock), 1, 'a refused confirmation leaves stock and intent untouched');
select is((select status from private.order_intents where id = (select (result ->> 'intentId')::uuid from stock_b)), 'awaiting_waiter',
  'the refused intent is still waiting');
delete from private.product_operational_stock;

insert into private.catalog_product_availability (tenant_id, location_id, product_id, is_available, updated_by)
values ((select t1 from scope), (select l1 from scope), '19b00000-0000-4000-8000-000000000001', false, '19100000-0000-4000-8000-000000000001');
select throws_ok($$ select pg_temp.decide((select waiter_a from staff), (select (result ->> 'intentId')::uuid from stock_b), '19e10000-0000-4000-8000-000000000010', 'confirm') $$,
  'PT104', null, 'availability is revalidated at confirmation');
delete from private.catalog_product_availability;
select pg_temp.publish(2, 14000);
select throws_ok($$ select pg_temp.decide((select waiter_a from staff), (select (result ->> 'intentId')::uuid from stock_b), '19e10000-0000-4000-8000-000000000011', 'confirm') $$,
  'PT211', null, 'a changed menu price is never charged silently');

-- Manual orders --------------------------------------------------------------
create temporary table manual as
select pg_temp.manual((select waiter_a from staff), '19600000-0000-4000-8000-000000000001', '19e20000-0000-4000-8000-000000000001') result;
select results_eq(
  $$ select result ->> 'source', (result ->> 'totalCents')::int, result #>> '{payment,state}', result ->> 'accountDecision' from manual $$,
  $$ values ('manual'::text, 14000, 'not_recorded'::text, 'pending'::text) $$,
  'a manual order is priced from the published menu and records no payment');
select is(pg_temp.manual((select waiter_a from staff), '19600000-0000-4000-8000-000000000001', '19e20000-0000-4000-8000-000000000001'),
  (select result from manual), 'a manual order is idempotent');
select throws_ok($$ select pg_temp.manual((select waiter_a from staff), '19600000-0000-4000-8000-000000000001', '19e20000-0000-4000-8000-000000000001', 'individual', 'Ana', 'Silla 1') $$,
  'PT100', null, 'a manual command id cannot be reused for another order');
select throws_ok($$ select pg_temp.manual((select waiter_a from staff), '19600000-0000-4000-8000-000000000001', '19e20000-0000-4000-8000-000000000002', 'individual') $$,
  'PT212', null, 'a person-attributed manual order needs a name and a seat');
select lives_ok($$ select pg_temp.manual((select waiter_a from staff), '19600000-0000-4000-8000-000000000001', '19e20000-0000-4000-8000-000000000003', 'individual', 'Ana', 'Silla 2') $$,
  'a manual order can be attributed to a person');
select throws_ok($$ select pg_temp.manual((select waiter_a from staff), '19600000-0000-4000-8000-000000000003', '19e20000-0000-4000-8000-000000000004') $$,
  'PT201', null, 'a waiter cannot load an order on a group member outside their sectors');
select throws_ok($$ select pg_temp.manual((select waiter_a from staff), '19600000-0000-4000-8000-000000000005', '19e20000-0000-4000-8000-000000000005') $$,
  'PT201', null, 'a table of another tenant is not found');
select throws_ok($$ select pg_temp.manual((select waiter_a from staff), '19600000-0000-4000-8000-000000000001', '19e20000-0000-4000-8000-000000000006',
  items => '[{"lineId":"19c00000-0000-4000-8000-000000000008","productId":"19b00000-0000-4000-8000-000000000001","variantId":null,"quantity":1,"unitPriceCents":1}]'::jsonb) $$,
  'PT212', null, 'a manual order never accepts a client price');
select throws_ok($$ select pg_temp.manual((select waiter_a from staff), '19600000-0000-4000-8000-000000000001', '19e20000-0000-4000-8000-000000000007',
  items => '[{"lineId":"19c00000-0000-4000-8000-000000000008","productId":"19b00000-0000-4000-8000-000000000099","variantId":null,"quantity":1}]'::jsonb) $$,
  'PT104', null, 'a product outside the published menu is refused');
update private.floor_table_service_states set state = 'needs_cleaning'
where table_id = '19600000-0000-4000-8000-000000000001';
select throws_ok($$ select pg_temp.manual((select waiter_a from staff), '19600000-0000-4000-8000-000000000001', '19e20000-0000-4000-8000-000000000008') $$,
  'PT210', null, 'a table pending cleaning is not enabled silently by an order');
select is((select state from private.floor_table_service_states where table_id = '19600000-0000-4000-8000-000000000001'), 'needs_cleaning',
  'refusing an order leaves the table state untouched');
select is((select count(*)::int from private.audit_events where action = 'order.manual_confirmed'), 2,
  'manual orders are audited');

select * from finish();
rollback;
