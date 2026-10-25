begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(106);

insert into auth.users (id) values
  ('2e100000-0000-4000-8000-000000000001'),
  ('2e100000-0000-4000-8000-000000000002'),
  ('2e100000-0000-4000-8000-000000000003');
insert into public.tenants (id, slug, name, status) values
  ('2e200000-0000-4000-8000-000000000001', 'mp-one', 'MP One', 'active'),
  ('2e200000-0000-4000-8000-000000000002', 'mp-two', 'MP Two', 'active');
insert into public.tenant_memberships (tenant_id, user_id, role) values
  ('2e200000-0000-4000-8000-000000000001', '2e100000-0000-4000-8000-000000000001', 'admin'),
  ('2e200000-0000-4000-8000-000000000002', '2e100000-0000-4000-8000-000000000002', 'admin');

create temporary table scope as select
  '2e200000-0000-4000-8000-000000000001'::uuid t1,
  (select id from public.locations where tenant_id = '2e200000-0000-4000-8000-000000000001') l1,
  '2e200000-0000-4000-8000-000000000002'::uuid t2,
  (select id from public.locations where tenant_id = '2e200000-0000-4000-8000-000000000002') l2,
  '2e100000-0000-4000-8000-000000000001'::uuid admin1,
  '2e100000-0000-4000-8000-000000000002'::uuid admin2,
  '2e100000-0000-4000-8000-000000000003'::uuid member1;

select private.save_floor_plan(
  (select t1 from scope), (select l1 from scope), (select admin1 from scope),
  '2e300000-0000-4000-8000-000000000001', 0,
  jsonb_build_object(
    'floors', jsonb_build_array(jsonb_build_object(
      'id','2e400000-0000-4000-8000-000000000001','name','Planta baja','position',0,'shortName',null)),
    'sectors', jsonb_build_array(
      jsonb_build_object('id','2e500000-0000-4000-8000-000000000001','name','Salón','position',0)),
    'tables', (
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'label', t.label, 'sectorId','2e500000-0000-4000-8000-000000000001',
        'floorId','2e400000-0000-4000-8000-000000000001','shape','square',
        'x', t.x,'y',40,'width',100,'height',100,'rotation',0,'seatCount',4,
        'seatLayout','perimeter'))
      from (values
        ('2e600000-0000-4000-8000-000000000001','1',40),
        ('2e600000-0000-4000-8000-000000000002','2',200),
        ('2e600000-0000-4000-8000-000000000003','3',360),
        ('2e600000-0000-4000-8000-000000000004','4',520)
      ) as t(id, label, x)),
    'groups', '[]'::jsonb
  )
);

create function pg_temp.member(username text, role text, sectors uuid[] default '{}')
returns uuid language sql as $$
  select (private.create_staff_member(
    (select t1 from scope), (select l1 from scope), (select admin1 from scope),
    username, initcap(username), role, 'scrypt-v1$c2FsdA$aGFzaA', sectors) ->> 'id')::uuid
$$;
create temporary table staff as select
  pg_temp.member('ana', 'waiter', array['2e500000-0000-4000-8000-000000000001'::uuid]) ana,
  pg_temp.member('marta', 'manager') manager;

insert into private.location_publications (tenant_id, location_id, published_by)
values ((select t1 from scope), (select l1 from scope), (select admin1 from scope));
insert into private.published_catalogs (
  tenant_id, location_id, revision, source_draft_revision, snapshot, published_by
) values (
  (select t1 from scope), (select l1 from scope), 1, 1,
  jsonb_build_object(
    'baseRevision', null,
    'categories', jsonb_build_array(jsonb_build_object(
      'id','2ea00000-0000-4000-8000-000000000001','position',0,
      'content',jsonb_build_array(jsonb_build_object('language','es','title','Todo','description','')))),
    'sectors', jsonb_build_array(
      jsonb_build_object('id','2ea00000-0000-4000-8000-000000000002','position',0,'name','Cocina','kind','kitchen'),
      jsonb_build_object('id','2ea00000-0000-4000-8000-000000000003','position',1,'name','Barra','kind','bar')),
    'products', (
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'categoryId','2ea00000-0000-4000-8000-000000000001',
        'sectorId', p.sector, 'position', p.pos, 'priceCents', p.price, 'imageAssetId', null,
        'content', jsonb_build_array(jsonb_build_object('language','es','title',p.title,'description','')),
        'variants', '[]'::jsonb))
      from (values
        ('2eb00000-0000-4000-8000-000000000001','2ea00000-0000-4000-8000-000000000002',0,12500,'Milanesa'),
        ('2eb00000-0000-4000-8000-000000000002','2ea00000-0000-4000-8000-000000000003',1,4000,'Cerveza')
      ) as p(id, sector, pos, price, title))),
  (select admin1 from scope));
select private.ensure_payment_methods((select t1 from scope), (select l1 from scope));
select private.ensure_payment_methods((select t2 from scope), (select l2 from scope));
insert into private.product_operational_stock (tenant_id, location_id, product_id, available_quantity)
values ((select t1 from scope), (select l1 from scope), '2eb00000-0000-4000-8000-000000000002', 2);

create function pg_temp.token(wanted_label text) returns text language sql as $$
  select qr.token from private.floor_table_qr_codes qr
  join private.floor_tables ft on ft.tenant_id = qr.tenant_id and ft.location_id = qr.location_id and ft.id = qr.table_id
  where ft.tenant_id = (select t1 from scope) and ft.label = wanted_label and qr.status = 'active'
$$;
create function pg_temp.intent(table_label text, command text, product text, quantity integer, method text default 'mercado_pago', path text default 'online')
returns jsonb language sql as $$
  select private.create_order_intent(
    (select t1 from scope), (select l1 from scope), pg_temp.token(table_label),
    command::uuid, 'table', 'Valentín', null, method, path,
    jsonb_build_array(jsonb_build_object(
      'lineId', '2ec00000-0000-4000-8000-' || right(command, 12),
      'productId', product, 'variantId', null, 'quantity', quantity)))
$$;
create function pg_temp.begin_payment(intent text, tenant uuid default null, location uuid default null) returns jsonb language sql as $$
  select private.begin_online_payment(
    coalesce(tenant, (select t1 from scope)), coalesce(location, (select l1 from scope)), intent::uuid)
$$;
-- A provider snapshot: minute offset from a fixed base so ordering is explicit.
create function pg_temp.snap(payment text, provider text, status text, amount integer, refunded integer, minute integer,
  reference text default null, detail text default null) returns jsonb language sql as $$
  select private.reconcile_online_payment(
    (select t1 from scope), (select l1 from scope), payment::uuid,
    coalesce(reference, payment), provider, status, detail, amount, refunded,
    timestamptz '2026-10-25 12:00:00+00' + make_interval(mins => minute))
$$;
create function pg_temp.entries(session uuid) returns bigint language sql as $$
  select count(*) from private.account_entries where session_id = session
$$;

-- Privileges -----------------------------------------------------------------
select ok(
  not has_table_privilege('authenticator', 'private.online_payments', 'select')
    and not has_table_privilege('authenticator', 'private.online_payments', 'update')
    and not has_table_privilege('authenticator', 'private.mp_connections', 'select')
    and not has_table_privilege('authenticator', 'private.mp_oauth_states', 'insert')
    and not has_table_privilege('authenticator', 'private.mp_webhook_events', 'select'),
  'the API role cannot read or write the Mercado Pago tables directly'
);
select ok(
  has_function_privilege('authenticator', 'private.reconcile_online_payment(uuid,uuid,uuid,text,text,text,text,integer,integer,timestamptz)', 'execute')
    and has_function_privilege('authenticator', 'private.begin_online_payment(uuid,uuid,uuid)', 'execute')
    and has_function_privilege('authenticator', 'private.claim_mp_webhook_event(text,uuid,uuid,text,text)', 'execute')
    and has_function_privilege('authenticator', 'private.read_mp_credentials(uuid,uuid)', 'execute'),
  'the API role executes the payment entry points'
);
select ok(
  not has_function_privilege('anon', 'private.reconcile_online_payment(uuid,uuid,uuid,text,text,text,text,integer,integer,timestamptz)', 'execute')
    and not has_function_privilege('authenticated', 'private.read_mp_credentials(uuid,uuid)', 'execute')
    and not has_function_privilege('authenticator', 'private.online_payment_json(private.online_payments)', 'execute'),
  'nobody else executes them, and the row serializer stays internal'
);

-- OAuth per business ---------------------------------------------------------------
select throws_ok(
  $$ select private.begin_mp_oauth((select t1 from scope), (select l1 from scope), (select member1 from scope), sha256('s1'), 600) $$,
  '42501', null, 'someone who is not an administrator cannot start the connection'
);
select throws_ok(
  $$ select private.begin_mp_oauth((select t1 from scope), (select l1 from scope), (select admin2 from scope), sha256('s1'), 600) $$,
  '42501', null, 'an administrator of another business cannot start it either'
);
select throws_ok(
  $$ select private.begin_mp_oauth((select t1 from scope), (select l1 from scope), (select admin1 from scope), sha256('s1'), 5) $$,
  'PT212', null, 'a state lives between a minute and an hour'
);
select ok(
  private.begin_mp_oauth((select t1 from scope), (select l1 from scope), (select admin1 from scope), sha256('s1'), 600) > now(),
  'the administrator starts the connection and gets its expiry'
);
select is(
  private.consume_mp_oauth_state(sha256('s1')),
  jsonb_build_object(
    'tenantId', (select t1 from scope), 'locationId', (select l1 from scope),
    'requesterId', (select admin1 from scope)),
  'the callback recovers who started it, from the state alone'
);
select throws_ok(
  $$ select private.consume_mp_oauth_state(sha256('s1')) $$,
  'PT250', null, 'a state works once'
);
select throws_ok(
  $$ select private.consume_mp_oauth_state(sha256('unknown')) $$,
  'PT250', null, 'an unknown state is refused'
);
select private.begin_mp_oauth((select t1 from scope), (select l1 from scope), (select admin1 from scope), sha256('s2'), 600);
update private.mp_oauth_states
set created_at = now() - interval '2 hours', expires_at = now() - interval '1 hour'
where state_hash = sha256('s2');
select throws_ok(
  $$ select private.consume_mp_oauth_state(sha256('s2')) $$,
  'PT250', null, 'an expired state is refused'
);
select ok(
  (select bool_and(octet_length(state_hash) = 32) from private.mp_oauth_states),
  'only the hash of a state is stored'
);

select throws_ok(
  $$ select private.finish_mp_connection((select t1 from scope), (select l1 from scope), (select member1 from scope), '1234567', false,
       'APP_USR-public-key-1', decode(repeat('ab', 40), 'hex'), 1::smallint) $$,
  '42501', null, 'only an administrator stores the connection'
);
select throws_ok(
  $$ select private.finish_mp_connection((select t1 from scope), (select l1 from scope), (select admin1 from scope), 'abc', false,
       'APP_USR-public-key-1', decode(repeat('ab', 40), 'hex'), 1::smallint) $$,
  'PT212', null, 'the seller id must be numeric'
);
select is(
  (select (elem ->> 'configured')::boolean
   from jsonb_array_elements(private.finish_mp_connection(
     (select t1 from scope), (select l1 from scope), (select admin1 from scope), '1234567', false,
     'APP_USR-public-key-1', decode(repeat('ab', 40), 'hex'), 1::smallint)) elem
   where elem ->> 'method' = 'mercado_pago'),
  true, 'the connection stores the sealed credential and reports it as configured'
);
select is(
  (select public_config ->> 'publicKey' from private.payment_methods
   where tenant_id = (select t1 from scope) and method_key = 'mercado_pago'),
  'APP_USR-public-key-1', 'the public key is kept for the checkout'
);
select is(
  (select mp_user_id from private.mp_connections where tenant_id = (select t1 from scope)),
  '1234567', 'the seller is bound to the business'
);
select throws_ok(
  $$ select private.finish_mp_connection((select t2 from scope), (select l2 from scope), (select admin2 from scope), '1234567', false,
       'APP_USR-public-key-2', decode(repeat('cd', 40), 'hex'), 1::smallint) $$,
  'PT251', null, 'a Mercado Pago account connects to one business only'
);
select is(
  private.resolve_mp_account('1234567'),
  jsonb_build_object('tenantId', (select t1 from scope), 'locationId', (select l1 from scope)),
  'a notification resolves to the business of its seller'
);
select is(private.resolve_mp_account('999'), null, 'an unknown seller resolves to nothing');
select ok(
  private.read_mp_credentials((select t1 from scope), (select l1 from scope)) ->> 'ciphertext' is not null
    and private.read_mp_credentials((select t1 from scope), (select l1 from scope)) ->> 'mpUserId' = '1234567',
  'the server-side flow reads the sealed credential of its own business'
);
select is(
  private.read_mp_credentials((select t2 from scope), (select l2 from scope)), null,
  'another business has no credential to read'
);
select lives_ok(
  $$ select private.replace_mp_credentials((select t1 from scope), (select l1 from scope), decode(repeat('ef', 40), 'hex'), 1::smallint) $$,
  'a refreshed token replaces the stored one'
);
select is(
  (select encode(ciphertext, 'hex') from private.payment_method_secrets where tenant_id = (select t1 from scope)),
  repeat('ef', 40), 'the replacement is what is stored'
);
select throws_ok(
  $$ select private.replace_mp_credentials((select t2 from scope), (select l2 from scope), decode(repeat('ef', 40), 'hex'), 1::smallint) $$,
  'PT201', null, 'there is nothing to replace in a business without a connection'
);
select lives_ok(
  $$ select private.update_payment_method((select t1 from scope), (select l1 from scope), (select admin1 from scope), 'mercado_pago', true, null) $$,
  'the administrator enables the connected method'
);

-- Online payment: attempts ----------------------------------------------------------------
create temporary table intents as select
  pg_temp.intent('1', '2ed00000-0000-4000-8000-000000000001', '2eb00000-0000-4000-8000-000000000001', 2) a,
  pg_temp.intent('2', '2ed00000-0000-4000-8000-000000000002', '2eb00000-0000-4000-8000-000000000002', 2) b,
  pg_temp.intent('3', '2ed00000-0000-4000-8000-000000000003', '2eb00000-0000-4000-8000-000000000001', 1) c,
  pg_temp.intent('4', '2ed00000-0000-4000-8000-000000000004', '2eb00000-0000-4000-8000-000000000001', 1, 'cash', 'in_person') d;
select is((select a ->> 'status' from intents), 'payment_pending', 'an online intent waits for its payment');
select is((select a ->> 'callId' from intents), null, 'it does not call a waiter');

create temporary table pay_a as select pg_temp.begin_payment((select a ->> 'intentId' from intents)) p;
select is((select p ->> 'status' from pay_a), 'created', 'an attempt starts created');
select is((select (p ->> 'amountCents')::int from pay_a), 25000, 'the amount is the intent total, nothing the caller sent');
select is(
  (select pg_temp.begin_payment((select a ->> 'intentId' from intents)) ->> 'paymentId'),
  (select p ->> 'paymentId' from pay_a), 'asking again returns the same live attempt'
);
select is(
  (select count(*)::int from private.online_payments where intent_id = (select (a ->> 'intentId')::uuid from intents)),
  1, 'and never creates a second one'
);
select throws_ok(
  $$ select pg_temp.begin_payment((select a ->> 'intentId' from intents), (select t2 from scope), (select l2 from scope)) $$,
  'PT201', null, 'another business cannot start a payment for this intent'
);
select throws_ok(
  $$ select pg_temp.begin_payment((select d ->> 'intentId' from intents)) $$,
  'PT252', null, 'an in-person intent has no online payment'
);
select is(
  (select private.online_payment_view((select t1 from scope), (select l1 from scope), (select (a ->> 'intentId')::uuid from intents)) -> 'payment' ->> 'status'),
  'created', 'the diner sees the state of the attempt'
);
select throws_ok(
  $$ select private.online_payment_view((select t2 from scope), (select l2 from scope), (select (a ->> 'intentId')::uuid from intents)) $$,
  'PT201', null, 'and only the owner business can read it'
);

-- Pending and mismatches change nothing -------------------------------------------------------
select is(
  (select pg_temp.snap((select p ->> 'paymentId' from pay_a), '5550001', 'pending', 25000, 0, 1) ->> 'outcome'),
  'applied', 'a pending snapshot is recorded'
);
select is((select status from private.online_payments where id = (select (p ->> 'paymentId')::uuid from pay_a)), 'pending', 'the attempt is pending');
select is(
  (select count(*)::int from private.confirmed_orders where tenant_id = (select t1 from scope)),
  0, 'pending confirms no order'
);
select is(
  (select count(*)::int from private.account_entries where tenant_id = (select t1 from scope)),
  0, 'pending writes no movement'
);
select is(
  (select status from private.order_intents where id = (select (a ->> 'intentId')::uuid from intents)),
  'payment_pending', 'the intent keeps waiting'
);
select throws_ok(
  $$ select pg_temp.snap((select p ->> 'paymentId' from pay_a), '5550001', 'approved', 25000, 0, 2, '2e000000-0000-4000-8000-0000000000aa') $$,
  'PT253', null, 'a snapshot for another reference is refused'
);
select throws_ok(
  $$ select pg_temp.snap((select p ->> 'paymentId' from pay_a), '5559999', 'approved', 25000, 0, 2) $$,
  'PT253', null, 'a snapshot of another provider payment is refused'
);
select is(
  (select pg_temp.snap((select p ->> 'paymentId' from pay_a), '5550001', 'approved', 100, 0, 2) ->> 'outcome'),
  'amount_mismatch', 'an approved snapshot for another amount is refused'
);
select is(
  (select count(*)::int from private.confirmed_orders where tenant_id = (select t1 from scope)),
  0, 'and confirms nothing'
);
select is(
  (select pg_temp.snap((select p ->> 'paymentId' from pay_a), '5550001', 'something_new', 25000, 0, 2) ->> 'outcome'),
  'ignored', 'an unknown provider status is ignored'
);

-- Approved confirms ---------------------------------------------------------------------------------
create temporary table approved as select pg_temp.snap((select p ->> 'paymentId' from pay_a), '5550001', 'approved', 25000, 0, 3) r;
select is((select r ->> 'outcome' from approved), 'applied', 'an approved snapshot is applied');
select is((select r ->> 'fulfillment' from approved), 'confirmed', 'it confirms the order');
select is(
  (select status from private.order_intents where id = (select (a ->> 'intentId')::uuid from intents)),
  'confirmed', 'the intent is confirmed'
);
select ok(
  (select confirmed_by is null and source = 'intent' from private.confirmed_orders where id = (select (r ->> 'orderId')::uuid from approved)),
  'the order was confirmed by the system, not by a person'
);
select is(
  (select count(*)::int from private.production_items where order_id = (select (r ->> 'orderId')::uuid from approved)),
  1, 'the order reaches production'
);
select is(
  (select jsonb_build_object('kind', kind, 'amount', amount_cents, 'method', payment_method, 'actor', actor_type, 'shift', shift_id)
   from private.account_entries where source_id = (select (p ->> 'paymentId')::uuid from pay_a)),
  jsonb_build_object('kind', 'payment', 'amount', -25000, 'method', 'mercado_pago', 'actor', 'system', 'shift', null),
  'the payment movement is online, by the system and outside any drawer'
);
select is(
  (select (private.account_summary((select t1 from scope), (select l1 from scope), (select session_id from private.confirmed_orders where id = (select (r ->> 'orderId')::uuid from approved))) ->> 'pendingCents')::int),
  0, 'the account is settled'
);
select is(
  (private.verify_account((select t1 from scope), (select l1 from scope),
    (select session_id from private.confirmed_orders where id = (select (r ->> 'orderId')::uuid from approved))) ->> 'matches')::boolean,
  true, 'the ledger still matches the consumption'
);

-- Repeats and reordering ------------------------------------------------------------------------------------
select is(
  (select pg_temp.snap((select p ->> 'paymentId' from pay_a), '5550001', 'approved', 25000, 0, 3) ->> 'outcome'),
  'unchanged', 'the same snapshot again changes nothing'
);
select is(
  (select pg_temp.entries((select session_id from private.online_payments where id = (select (p ->> 'paymentId')::uuid from pay_a)))),
  2::bigint, 'and writes no second movement'
);
select is(
  (select pg_temp.snap((select p ->> 'paymentId' from pay_a), '5550001', 'pending', 25000, 0, 1) ->> 'outcome'),
  'stale', 'an older snapshot is ignored'
);
select is(
  (select pg_temp.snap((select p ->> 'paymentId' from pay_a), '5550001', 'pending', 25000, 0, 9) ->> 'outcome'),
  'stale', 'a later pending snapshot cannot downgrade an accredited payment'
);
select is(
  (select pg_temp.snap((select p ->> 'paymentId' from pay_a), '5550001', 'rejected', 25000, 0, 10) ->> 'outcome'),
  'stale', 'nor can a rejection'
);
select is(
  (select status from private.online_payments where id = (select (p ->> 'paymentId')::uuid from pay_a)),
  'approved', 'the payment is still approved'
);

-- Partial refunds -----------------------------------------------------------------------------------------------
select is(
  (select pg_temp.snap((select p ->> 'paymentId' from pay_a), '5550001', 'approved', 25000, 5000, 11) ->> 'outcome'),
  'applied', 'a partial refund reported by the provider is applied'
);
select is(
  (select jsonb_build_object('amount', amount_cents, 'method', payment_method, 'of', refund_of_source_id)
   from private.account_entries where kind = 'refund' and tenant_id = (select t1 from scope)),
  jsonb_build_object('amount', 5000, 'method', 'mercado_pago', 'of', (select p ->> 'paymentId' from pay_a)),
  'it is recorded once, linked to the payment'
);
select is(
  (select pg_temp.snap((select p ->> 'paymentId' from pay_a), '5550001', 'approved', 25000, 5000, 12) ->> 'outcome'),
  'unchanged', 'the same refund again changes nothing'
);
select is(
  (select pg_temp.snap((select p ->> 'paymentId' from pay_a), '5550001', 'approved', 25000, 2000, 13) ->> 'outcome'),
  'unchanged', 'a lower refunded amount never reduces what was recorded'
);
select is(
  (select pg_temp.snap((select p ->> 'paymentId' from pay_a), '5550001', 'approved', 25000, 12000, 14) ->> 'outcome'),
  'applied', 'a second partial refund is applied'
);
select is(
  (select sum(amount_cents)::int from private.account_entries where kind = 'refund' and tenant_id = (select t1 from scope)),
  12000, 'only the increase was added'
);
select throws_ok(
  $$ select pg_temp.snap((select p ->> 'paymentId' from pay_a), '5550001', 'approved', 25000, 25001, 15) $$,
  'PT253', null, 'a refund above the payment is refused'
);
select is(
  (select refunded_cents from private.online_payments where id = (select (p ->> 'paymentId')::uuid from pay_a)),
  12000, 'the payment tracks what was given back'
);

-- Online money and the drawer --------------------------------------------------------------------------------------
select private.open_cash_shift((select t1 from scope), (select l1 from scope), (select manager from staff), '2ee00000-0000-4000-8000-000000000001', 0);
select throws_ok(
  $$ select private.record_account_refund((select t1 from scope), (select l1 from scope), (select manager from staff),
       '2ee00000-0000-4000-8000-000000000002',
       (select session_id from private.online_payments where id = (select (p ->> 'paymentId')::uuid from pay_a)),
       (select (p ->> 'paymentId')::uuid from pay_a), 100, null, 'Prueba') $$,
  'PT243', null, 'an in-person refund cannot return an online payment'
);
select throws_ok(
  $$ insert into private.account_entries (tenant_id, location_id, session_id, kind, amount_cents, origin, cause, source_type, source_id, actor_type, payment_method, shift_id)
     select tenant_id, location_id, session_id, 'payment', -1, 'payment', 'x', 'payment', gen_random_uuid(), 'system', 'mercado_pago',
       (select id from private.cash_shifts where tenant_id = (select t1 from scope))
     from private.online_payments where id = (select (p ->> 'paymentId')::uuid from pay_a) $$,
  '23514', null, 'an online movement cannot sit in a register shift'
);

-- Refund requests ---------------------------------------------------------------------------------------------------------
select private.cancel_order_item(
  (select t1 from scope), (select l1 from scope), (select manager from staff), '2ee00000-0000-4000-8000-000000000003',
  (select (r ->> 'orderId')::uuid from approved),
  (select line_id from private.confirmed_order_items where order_id = (select (r ->> 'orderId')::uuid from approved) limit 1),
  'Sin stock');
select throws_ok(
  $$ select private.prepare_online_refund((select t1 from scope), (select l1 from scope), (select ana from staff),
       (select session_id from private.online_payments where id = (select (p ->> 'paymentId')::uuid from pay_a)),
       (select (p ->> 'paymentId')::uuid from pay_a), 100) $$,
  'PT222', null, 'a waiter cannot refund an online payment'
);
select throws_ok(
  $$ select private.prepare_online_refund((select t1 from scope), (select l1 from scope), (select manager from staff),
       (select session_id from private.online_payments where id = (select (p ->> 'paymentId')::uuid from pay_a)),
       (select (p ->> 'paymentId')::uuid from pay_a), 13001) $$,
  'PT242', null, 'a refund above the credit and the rest of the payment is refused'
);
select is(
  (select private.prepare_online_refund((select t1 from scope), (select l1 from scope), (select manager from staff),
       (select session_id from private.online_payments where id = (select (p ->> 'paymentId')::uuid from pay_a)),
       (select (p ->> 'paymentId')::uuid from pay_a), 13000) ->> 'providerPaymentId'),
  '5550001', 'a manager gets the provider payment to refund, up to the limit'
);
select throws_ok(
  $$ select private.prepare_online_refund((select t1 from scope), (select l1 from scope), (select manager from staff),
       '2ef00000-0000-4000-8000-0000000000ff', (select (p ->> 'paymentId')::uuid from pay_a), 100) $$,
  'PT201', null, 'a payment is only refunded from its own account'
);

-- A paid order that cannot be served ---------------------------------------------------------------------------------------------
create temporary table pay_b as select pg_temp.begin_payment((select b ->> 'intentId' from intents)) p;
update private.product_operational_stock set available_quantity = 0
where tenant_id = (select t1 from scope) and product_id = '2eb00000-0000-4000-8000-000000000002';
create temporary table approved_b as select pg_temp.snap((select p ->> 'paymentId' from pay_b), '5550002', 'approved', 8000, 0, 3) r;
select is((select r ->> 'outcome' from approved_b), 'needs_refund', 'an accredited payment whose stock is gone is flagged for return');
select is(
  (select jsonb_build_object('status', status, 'fulfillment', fulfillment, 'order', order_id)
   from private.online_payments where id = (select (p ->> 'paymentId')::uuid from pay_b)),
  jsonb_build_object('status', 'approved', 'fulfillment', 'needs_refund', 'order', null),
  'the money is recorded and no order exists'
);
select is(
  (select status from private.order_intents where id = (select (b ->> 'intentId')::uuid from intents)),
  'payment_pending', 'the intent was not confirmed'
);
select throws_ok(
  $$ update private.order_intents set status = 'confirmed' where id = (select (b ->> 'intentId')::uuid from intents) $$,
  'PT209', null, 'and nobody can confirm it by writing the table'
);
select is(
  (select count(*)::int from private.account_entries where source_id = (select (p ->> 'paymentId')::uuid from pay_b)),
  0, 'no movement was written for it'
);
select is(
  (select jsonb_array_length(private.online_payments_needing_refund(10))),
  1, 'it is listed as needing a refund'
);
select is(
  (select pg_temp.snap((select p ->> 'paymentId' from pay_b), '5550002', 'refunded', 8000, 8000, 4) ->> 'outcome'),
  'applied', 'the provider reports the full refund'
);
select is(
  (select fulfillment from private.online_payments where id = (select (p ->> 'paymentId')::uuid from pay_b)),
  'closed', 'and the case is closed'
);
select is(
  (select jsonb_array_length(private.online_payments_needing_refund(10))), 0, 'nothing is left to return'
);

-- Rejection ----------------------------------------------------------------------------------------------------------------------------
create temporary table pay_c as select pg_temp.begin_payment((select c ->> 'intentId' from intents)) p;
select is(
  (select pg_temp.snap((select p ->> 'paymentId' from pay_c), '5550003', 'rejected', 12500, 0, 1, null, 'cc_rejected_insufficient_amount') ->> 'outcome'),
  'applied', 'a rejection is recorded'
);
select is(
  (select jsonb_build_object('status', status, 'detail', provider_status_detail) from private.online_payments where id = (select (p ->> 'paymentId')::uuid from pay_c)),
  jsonb_build_object('status', 'rejected', 'detail', 'cc_rejected_insufficient_amount'),
  'with the reason the provider gave'
);
select is(
  (select count(*)::int from private.confirmed_orders where intent_id = (select (c ->> 'intentId')::uuid from intents)),
  0, 'a rejection confirms nothing'
);
select isnt(
  (select pg_temp.begin_payment((select c ->> 'intentId' from intents)) ->> 'paymentId'),
  (select p ->> 'paymentId' from pay_c), 'the diner can try again with a new attempt'
);
select is(
  (select pg_temp.snap((select p ->> 'paymentId' from pay_c), '5550003', 'approved', 12500, 0, 5) ->> 'outcome'),
  'stale', 'a rejected attempt cannot be accredited later'
);

-- Tamper guards -----------------------------------------------------------------------------------------------------------------------------
select throws_ok(
  $$ update private.online_payments set amount_cents = 1 where id = (select (p ->> 'paymentId')::uuid from pay_a) $$,
  'PT209', null, 'the amount cannot be rewritten'
);
select throws_ok(
  $$ update private.online_payments set status = 'pending' where id = (select (p ->> 'paymentId')::uuid from pay_a) $$,
  'PT209', null, 'an accredited payment cannot be downgraded'
);
select throws_ok(
  $$ update private.online_payments set refunded_cents = 0 where id = (select (p ->> 'paymentId')::uuid from pay_a) $$,
  'PT209', null, 'what was refunded cannot be reduced'
);
select throws_ok(
  $$ update private.online_payments set provider_payment_id = '1' where id = (select (p ->> 'paymentId')::uuid from pay_a) $$,
  'PT209', null, 'the provider payment cannot be swapped'
);
select throws_ok(
  $$ delete from private.online_payments where id = (select (p ->> 'paymentId')::uuid from pay_a) $$,
  'PT209', null, 'payments are never deleted'
);
select throws_ok(
  $$ insert into private.online_payments (tenant_id, location_id, intent_id, amount_cents, status)
     select tenant_id, location_id, intent_id, amount_cents, 'approved' from private.online_payments where id = (select (p ->> 'paymentId')::uuid from pay_a) $$,
  '23514', null, 'an approved payment cannot be inserted without a provider reference'
);
select throws_ok(
  $$ insert into private.online_payments (tenant_id, location_id, intent_id, amount_cents)
     select tenant_id, location_id, intent_id, amount_cents from private.online_payments where id = (select (p ->> 'paymentId')::uuid from pay_a) $$,
  '23505', null, 'an intent has one live attempt at a time'
);

-- Webhook events ------------------------------------------------------------------------------------------------------------------------------
select is(
  private.claim_mp_webhook_event('payment:111', (select t1 from scope), (select l1 from scope), 'payment', '5550001'),
  'new', 'a notification is recorded the first time'
);
select is(
  private.claim_mp_webhook_event('payment:111', (select t1 from scope), (select l1 from scope), 'payment', '5550001'),
  'retry', 'one that never finished is processed again'
);
select is((select attempts from private.mp_webhook_events where event_key = 'payment:111'), 2, 'and counted');
select lives_ok($$ select private.finish_mp_webhook_event('payment:111', 'applied') $$, 'it finishes with its outcome');
select is(
  private.claim_mp_webhook_event('payment:111', (select t1 from scope), (select l1 from scope), 'payment', '5550001'),
  'duplicate', 'a processed notification is a duplicate'
);
select is(
  private.claim_mp_webhook_event('payment:222', null, null, 'payment', '777'),
  'new', 'a notification of an unknown seller is recorded too'
);
select throws_ok(
  $$ select private.finish_mp_webhook_event('payment:222', 'whatever') $$,
  '23514', null, 'outcomes are a closed list'
);
select lives_ok($$ select private.finish_mp_webhook_event('payment:222', 'unknown_seller') $$, 'and closed');

-- Audit -------------------------------------------------------------------------------------------------------------------------------------------
select ok(
  exists (select 1 from private.audit_events where tenant_id = (select t1 from scope) and action = 'online_payment.confirmed' and actor_type = 'system'),
  'the confirmation is audited as the system'
);
select ok(
  exists (select 1 from private.audit_events where tenant_id = (select t1 from scope) and action = 'online_payment.needs_refund')
    and exists (select 1 from private.audit_events where tenant_id = (select t1 from scope) and action = 'online_payment.amount_mismatch')
    and exists (select 1 from private.audit_events where tenant_id = (select t1 from scope) and action = 'payment_provider.connected'),
  'failures and the connection are audited'
);
select is(
  (select count(*)::int from private.online_payments where tenant_id = (select t2 from scope)),
  0, 'the other business has no payments at all'
);

select * from finish();
rollback;
