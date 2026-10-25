begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(27);

insert into auth.users (id) values ('2b100000-0000-4000-8000-000000000001'), ('2b100000-0000-4000-8000-000000000002');
insert into public.tenants (id, slug, name, status) values
  ('2b200000-0000-4000-8000-000000000001', 'cash-one', 'Cash One', 'active'),
  ('2b200000-0000-4000-8000-000000000002', 'cash-two', 'Cash Two', 'active');
insert into public.tenant_memberships (tenant_id, user_id, role)
values ('2b200000-0000-4000-8000-000000000001', '2b100000-0000-4000-8000-000000000001', 'admin'),
  ('2b200000-0000-4000-8000-000000000002', '2b100000-0000-4000-8000-000000000002', 'admin');

create temporary table scope as select
  '2b200000-0000-4000-8000-000000000001'::uuid t1,
  (select id from public.locations where tenant_id = '2b200000-0000-4000-8000-000000000001') l1,
  '2b200000-0000-4000-8000-000000000002'::uuid t2,
  (select id from public.locations where tenant_id = '2b200000-0000-4000-8000-000000000002') l2;

select private.save_floor_plan(
  (select t1 from scope), (select l1 from scope),
  '2b100000-0000-4000-8000-000000000001',
  '2b300000-0000-4000-8000-000000000001', 0,
  jsonb_build_object(
    'floors', jsonb_build_array(jsonb_build_object(
      'id','2b400000-0000-4000-8000-000000000001','name','Planta baja','position',0,'shortName',null)),
    'sectors', jsonb_build_array(
      jsonb_build_object('id','2b500000-0000-4000-8000-000000000001','name','Salón','position',0)),
    'tables', (
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'label', t.label, 'sectorId','2b500000-0000-4000-8000-000000000001',
        'floorId','2b400000-0000-4000-8000-000000000001','shape','square',
        'x', t.x,'y',40,'width',100,'height',100,'rotation',0,'seatCount',4,
        'seatLayout','perimeter'))
      from (values
        ('2b600000-0000-4000-8000-000000000001','1',40),
        ('2b600000-0000-4000-8000-000000000002','2',200),
        ('2b600000-0000-4000-8000-000000000003','3',360)
      ) as t(id, label, x)),
    'groups', '[]'::jsonb
  )
);

create function pg_temp.member(username text, role text, sectors uuid[] default '{}')
returns uuid language sql as $$
  select (private.create_staff_member(
    (select t1 from scope), (select l1 from scope),
    '2b100000-0000-4000-8000-000000000001',
    username, initcap(username), role, 'scrypt-v1$c2FsdA$aGFzaA', sectors) ->> 'id')::uuid
$$;
create temporary table staff as select
  pg_temp.member('ana', 'waiter', array['2b500000-0000-4000-8000-000000000001'::uuid]) ana,
  pg_temp.member('marta', 'manager') manager,
  pg_temp.member('coco', 'kitchen') kitchen;
insert into public.staff_members (id, tenant_id, location_id, username, display_name, role, created_by)
values ('2b800000-0000-4000-8000-000000000001', (select t2 from scope), (select l2 from scope),
  'otra', 'Otra', 'manager', '2b100000-0000-4000-8000-000000000001');

insert into private.location_publications (tenant_id, location_id, published_by)
values ((select t1 from scope), (select l1 from scope), '2b100000-0000-4000-8000-000000000001');
insert into private.published_catalogs (
  tenant_id, location_id, revision, source_draft_revision, snapshot, published_by
) values (
  (select t1 from scope), (select l1 from scope), 1, 1,
  jsonb_build_object(
    'baseRevision', null,
    'categories', jsonb_build_array(jsonb_build_object(
      'id','2ba00000-0000-4000-8000-000000000001','position',0,
      'content',jsonb_build_array(jsonb_build_object('language','es','title','Todo','description','')))),
    'sectors', jsonb_build_array(
      jsonb_build_object('id','2ba00000-0000-4000-8000-000000000002','position',0,'name','Cocina','kind','kitchen'),
      jsonb_build_object('id','2ba00000-0000-4000-8000-000000000003','position',1,'name','Barra','kind','bar')),
    'products', (
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'categoryId','2ba00000-0000-4000-8000-000000000001',
        'sectorId', p.sector, 'position', p.pos, 'priceCents', p.price, 'imageAssetId', null,
        'content', jsonb_build_array(jsonb_build_object('language','es','title',p.title,'description','')),
        'variants', '[]'::jsonb))
      from (values
        ('2bb00000-0000-4000-8000-000000000001','2ba00000-0000-4000-8000-000000000002',0,12500,'Milanesa'),
        ('2bb00000-0000-4000-8000-000000000002','2ba00000-0000-4000-8000-000000000003',1,4000,'Cerveza')
      ) as p(id, sector, pos, price, title))),
  '2b100000-0000-4000-8000-000000000001');
select private.ensure_payment_methods((select t1 from scope), (select l1 from scope));

create function pg_temp.line(n integer, product text, quantity integer default 1) returns jsonb language sql as $$
  select jsonb_build_object('lineId', '2bc00000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'),
    'productId', product, 'variantId', null, 'quantity', quantity)
$$;
create function pg_temp.manual(command text, table_id text, items jsonb) returns jsonb language sql as $$
  select private.create_manual_order((select t1 from scope), (select l1 from scope),
    (select manager from staff), command::uuid, table_id::uuid, 'table', null, null, items)
$$;
create function pg_temp.session_of(wanted text) returns uuid language sql as $$
  select s.id from private.table_sessions s where s.status = 'open' and s.scope_key = wanted::uuid
$$;
create function pg_temp.open_shift(staff uuid, command text, opening integer) returns jsonb language sql as $$
  select private.open_cash_shift((select t1 from scope), (select l1 from scope), staff, command::uuid, opening)
$$;
create function pg_temp.movement(staff uuid, command text, kind text, amount integer, reason text default 'Retiro a caja fuerte') returns jsonb language sql as $$
  select private.record_cash_movement((select t1 from scope), (select l1 from scope), staff, command::uuid, kind, amount, reason)
$$;
create function pg_temp.close_shift(staff uuid, command text, counted integer, reason text default null) returns jsonb language sql as $$
  select private.close_cash_shift((select t1 from scope), (select l1 from scope), staff, command::uuid, counted, reason)
$$;
create function pg_temp.pay(staff uuid, command text, session uuid, method text, amount integer default null, tip integer default 0) returns jsonb language sql as $$
  select private.record_account_payment((select t1 from scope), (select l1 from scope), staff, command::uuid, session, method, amount, tip)
$$;
create function pg_temp.refund(staff uuid, command text, session uuid, payment uuid, amount integer, line text default null, reason text default 'Devolución de ítem') returns jsonb language sql as $$
  select private.record_account_refund((select t1 from scope), (select l1 from scope), staff, command::uuid, session, payment, amount, line::uuid, reason)
$$;
create function pg_temp.cancel(staff uuid, command text, order_id uuid, line text) returns jsonb language sql as $$
  select private.cancel_order_item((select t1 from scope), (select l1 from scope), staff, command::uuid, order_id, line::uuid, 'Sin stock')
$$;
create function pg_temp.view(staff uuid) returns jsonb language sql as $$
  select private.cash_register_view((select t1 from scope), (select l1 from scope), staff)
$$;

create function pg_temp.token(wanted text) returns text language sql as $$
  select qr.token from private.floor_table_qr_codes qr
  join private.floor_tables ft on ft.tenant_id = qr.tenant_id and ft.location_id = qr.location_id and ft.id = qr.table_id
  where ft.tenant_id = (select t1 from scope) and ft.label = wanted and qr.status = 'active'
$$;
create function pg_temp.split(staff uuid, command text, session uuid, parts integer) returns jsonb language sql as $$
  select private.create_account_split((select t1 from scope), (select l1 from scope), staff, command::uuid, session, parts)
$$;
create function pg_temp.claim(tok text, pos integer, label text, secret text) returns jsonb language sql as $$
  select private.claim_split_share((select t1 from scope), (select l1 from scope), tok, pos, label, sha256(secret::bytea))
$$;
create function pg_temp.begin_share(tok text, pos integer, secret text) returns jsonb language sql as $$
  select private.begin_share_online_payment((select t1 from scope), (select l1 from scope), tok, pos, sha256(secret::bytea))
$$;
create function pg_temp.snap(payment text, provider text, status text, amount integer, refunded integer, minute integer) returns jsonb language sql as $$
  select private.reconcile_online_payment((select t1 from scope), (select l1 from scope), payment::uuid,
    payment, provider, status, null, amount, refunded, timestamptz '2026-10-26 12:00:00+00' + make_interval(mins => minute))
$$;

select ok(
  has_function_privilege('authenticator', 'private.begin_share_online_payment(uuid,uuid,text,integer,bytea)', 'execute')
    and not has_function_privilege('authenticator', 'private.claim_share_for_payment(uuid)', 'execute'),
  'only the entry points are reachable');

select pg_temp.manual('2b900000-0000-4000-8000-000000000201', '2b600000-0000-4000-8000-000000000001',
  jsonb_build_array(pg_temp.line(1, '2bb00000-0000-4000-8000-000000000001', 1), pg_temp.line(2, '2bb00000-0000-4000-8000-000000000002', 1)));
create temporary table s1 as select pg_temp.session_of('2b600000-0000-4000-8000-000000000001') id;
select pg_temp.split((select ana from staff), '2b900000-0000-4000-8000-000000000202', (select id from s1), 2);
select pg_temp.claim(pg_temp.token('1'), 1, 'Ana', 'device-a');

select throws_ok($$ select pg_temp.begin_share(pg_temp.token('1'), 1, 'device-b') $$, 'PT260', null, 'another device cannot pay a share it did not reserve');
select throws_ok($$ select pg_temp.begin_share(pg_temp.token('1'), 2, 'device-a') $$, 'PT260', null, 'nor one that nobody reserved');
select throws_ok($$ select pg_temp.begin_share(pg_temp.token('2'), 1, 'device-a') $$, 'PT201', null, 'a table without an account has nothing to pay');
create temporary table pay1 as select pg_temp.begin_share(pg_temp.token('1'), 1, 'device-a') p;
select is((select (p ->> 'amountCents')::int from pay1), 8250, 'the amount is the share, nothing the caller sent');
select is((select p ->> 'status' from pay1), 'created', 'the attempt starts created');
select is(pg_temp.begin_share(pg_temp.token('1'), 1, 'device-a') ->> 'paymentId', (select p ->> 'paymentId' from pay1), 'asking again returns the same attempt');

select is(pg_temp.snap((select p ->> 'paymentId' from pay1), '6660001', 'pending', 8250, 0, 1) ->> 'outcome', 'applied', 'a pending snapshot is recorded');
select is((select status from private.account_split_shares where payment_id is null and position = 1 and split_id = (select share_split_id from private.online_payments where id = (select (p ->> 'paymentId')::uuid from pay1))), 'claimed', 'pending leaves the share reserved');
select is((select count(*)::int from private.account_entries where session_id = (select id from s1) and kind = 'payment'), 0, 'and writes no movement');

create temporary table approved as select pg_temp.snap((select p ->> 'paymentId' from pay1), '6660001', 'approved', 8250, 0, 2) r;
select is((select r ->> 'outcome' from approved), 'applied', 'an approved snapshot is applied');
select is((select r ->> 'fulfillment' from approved), 'confirmed', 'it confirms the share');
select is((select r ->> 'orderId' from approved), null, 'with no order involved');
select is(
  (select jsonb_build_object('kind', kind, 'amount', amount_cents, 'method', payment_method, 'actor', actor_type, 'shift', shift_id)
   from private.account_entries where source_id = (select (p ->> 'paymentId')::uuid from pay1)),
  jsonb_build_object('kind', 'payment', 'amount', -8250, 'method', 'mercado_pago', 'actor', 'system', 'shift', null),
  'the movement is online, by the system and outside any drawer');
select is((select status from private.account_split_shares where payment_id = (select (p ->> 'paymentId')::uuid from pay1)), 'paid', 'the share is paid by that payment');
select is((private.account_summary((select t1 from scope), (select l1 from scope), (select id from s1)) ->> 'pendingCents')::int, 8250, 'the balance drops by the share');
select is(pg_temp.snap((select p ->> 'paymentId' from pay1), '6660001', 'approved', 8250, 0, 2) ->> 'outcome', 'unchanged', 'the same snapshot again changes nothing');
select is((select count(*)::int from private.account_entries where session_id = (select id from s1) and kind = 'payment'), 1, 'and writes no second movement');
select is(pg_temp.snap((select p ->> 'paymentId' from pay1), '6660001', 'approved', 8250, 1000, 3) ->> 'outcome', 'applied', 'a partial refund is applied');
select is((select jsonb_build_object('amount', amount_cents, 'of', refund_of_source_id) from private.account_entries where kind = 'refund' and session_id = (select id from s1)),
  jsonb_build_object('amount', 1000, 'of', (select p ->> 'paymentId' from pay1)), 'and linked to the payment');
select is(private.share_payment_view((select t1 from scope), (select l1 from scope), pg_temp.token('1'), 1, sha256('device-a'::bytea)) ->> 'shareStatus', 'paid', 'the diner reads the share as paid');

-- The share is voided before the provider approves: the money goes back.
select pg_temp.claim(pg_temp.token('1'), 2, 'Beto', 'device-b');
create temporary table pay2 as select pg_temp.begin_share(pg_temp.token('1'), 2, 'device-b') p;
select pg_temp.split((select ana from staff), '2b900000-0000-4000-8000-000000000203', (select id from s1), 2);
create temporary table late as select pg_temp.snap((select p ->> 'paymentId' from pay2), '6660002', 'approved', 8250, 0, 5) r;
select is((select r ->> 'outcome' from late), 'needs_refund', 'an approved payment for a voided share is flagged for return');
select is((select count(*)::int from private.account_entries where source_id = (select (p ->> 'paymentId')::uuid from pay2)), 0, 'with no movement written');
select is(jsonb_array_length(private.online_payments_needing_refund(10)), 1, 'and listed to be returned');
select is(pg_temp.snap((select p ->> 'paymentId' from pay1), '6660001', 'approved', 100, 1000, 6) ->> 'outcome', 'amount_mismatch', 'a snapshot for another amount is refused');
select throws_ok($$ insert into private.online_payments (tenant_id, location_id, amount_cents) values ((select t1 from scope), (select l1 from scope), 100) $$, '23514', null, 'a payment belongs to an intent or a share');
select throws_ok($$ select private.begin_share_online_payment((select t1 from scope), (select l1 from scope), repeat('0', 64), 1, sha256('x'::bytea)) $$, 'PT201', null, 'an invented token pays nothing');

select * from finish();
rollback;
