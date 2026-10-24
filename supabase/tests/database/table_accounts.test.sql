begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(88);

insert into auth.users (id) values ('1e100000-0000-4000-8000-000000000001'), ('1e100000-0000-4000-8000-000000000002');
insert into public.tenants (id, slug, name, status) values
  ('1e200000-0000-4000-8000-000000000001', 'acc-one', 'Acc One', 'active'),
  ('1e200000-0000-4000-8000-000000000002', 'acc-two', 'Acc Two', 'active');
insert into public.tenant_memberships (tenant_id, user_id, role)
values ('1e200000-0000-4000-8000-000000000001', '1e100000-0000-4000-8000-000000000001', 'admin'),
  ('1e200000-0000-4000-8000-000000000002', '1e100000-0000-4000-8000-000000000002', 'admin');

create temporary table scope as select
  '1e200000-0000-4000-8000-000000000001'::uuid t1,
  (select id from public.locations where tenant_id = '1e200000-0000-4000-8000-000000000001') l1,
  '1e200000-0000-4000-8000-000000000002'::uuid t2,
  (select id from public.locations where tenant_id = '1e200000-0000-4000-8000-000000000002') l2;

-- S1: tables 1 and 2. S2: table 3. Tables 2 and 3 form a group.
select private.save_floor_plan(
  (select t1 from scope), (select l1 from scope),
  '1e100000-0000-4000-8000-000000000001',
  '1e300000-0000-4000-8000-000000000001', 0,
  jsonb_build_object(
    'floors', jsonb_build_array(jsonb_build_object(
      'id','1e400000-0000-4000-8000-000000000001','name','Planta baja','position',0,'shortName',null)),
    'sectors', jsonb_build_array(
      jsonb_build_object('id','1e500000-0000-4000-8000-000000000001','name','Salón','position',0),
      jsonb_build_object('id','1e500000-0000-4000-8000-000000000002','name','Terraza','position',1)),
    'tables', (
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'label', t.label, 'sectorId', t.sector,
        'floorId','1e400000-0000-4000-8000-000000000001','shape','square',
        'x', t.x,'y',40,'width',100,'height',100,'rotation',0,'seatCount',4,
        'seatLayout','perimeter'))
      from (values
        ('1e600000-0000-4000-8000-000000000001','1','1e500000-0000-4000-8000-000000000001',40),
        ('1e600000-0000-4000-8000-000000000002','2','1e500000-0000-4000-8000-000000000001',200),
        ('1e600000-0000-4000-8000-000000000003','3','1e500000-0000-4000-8000-000000000002',360)
      ) as t(id, label, sector, x)),
    'groups', '[]'::jsonb
  )
);
insert into private.floor_groups (tenant_id, location_id, id, name, position)
values ((select t1 from scope), (select l1 from scope), '1e700000-0000-4000-8000-000000000001', 'Cumple', 0);
insert into private.floor_group_members (tenant_id, location_id, group_id, table_id, position)
values
  ((select t1 from scope), (select l1 from scope), '1e700000-0000-4000-8000-000000000001', '1e600000-0000-4000-8000-000000000002', 0),
  ((select t1 from scope), (select l1 from scope), '1e700000-0000-4000-8000-000000000001', '1e600000-0000-4000-8000-000000000003', 1);

create function pg_temp.member(username text, role text, sectors uuid[] default '{}')
returns uuid language sql as $$
  select (private.create_staff_member(
    (select t1 from scope), (select l1 from scope),
    '1e100000-0000-4000-8000-000000000001',
    username, initcap(username), role, 'scrypt-v1$c2FsdA$aGFzaA', sectors) ->> 'id')::uuid
$$;
create temporary table staff as select
  pg_temp.member('ana', 'waiter', array['1e500000-0000-4000-8000-000000000001'::uuid]) ana,
  pg_temp.member('bruno', 'waiter', array['1e500000-0000-4000-8000-000000000002'::uuid]) bruno,
  pg_temp.member('marta', 'manager') manager,
  pg_temp.member('coco', 'kitchen') kitchen,
  pg_temp.member('beto', 'bar') bar;
insert into public.staff_members (id, tenant_id, location_id, username, display_name, role, created_by)
values ('1e800000-0000-4000-8000-000000000001', (select t2 from scope), (select l2 from scope),
  'otro', 'Otro', 'waiter', '1e100000-0000-4000-8000-000000000001');

insert into private.location_publications (tenant_id, location_id, published_by)
values ((select t1 from scope), (select l1 from scope), '1e100000-0000-4000-8000-000000000001');
insert into private.published_catalogs (
  tenant_id, location_id, revision, source_draft_revision, snapshot, published_by
) values (
  (select t1 from scope), (select l1 from scope), 1, 1,
  jsonb_build_object(
    'baseRevision', null,
    'categories', jsonb_build_array(jsonb_build_object(
      'id','1ea00000-0000-4000-8000-000000000001','position',0,
      'content',jsonb_build_array(jsonb_build_object('language','es','title','Todo','description','')))),
    'sectors', jsonb_build_array(
      jsonb_build_object('id','1ea00000-0000-4000-8000-000000000002','position',0,'name','Cocina','kind','kitchen'),
      jsonb_build_object('id','1ea00000-0000-4000-8000-000000000003','position',1,'name','Barra','kind','bar')),
    'products', (
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'categoryId','1ea00000-0000-4000-8000-000000000001',
        'sectorId', p.sector, 'position', p.pos, 'priceCents', p.price, 'imageAssetId', null,
        'content', jsonb_build_array(jsonb_build_object('language','es','title',p.title,'description','')),
        'variants', '[]'::jsonb))
      from (values
        ('1eb00000-0000-4000-8000-000000000001','1ea00000-0000-4000-8000-000000000002',0,12500,'Milanesa'),
        ('1eb00000-0000-4000-8000-000000000002','1ea00000-0000-4000-8000-000000000003',1,4000,'Cerveza'),
        ('1eb00000-0000-4000-8000-000000000003','1ea00000-0000-4000-8000-000000000003',2,6900,'Vino'),
        ('1eb00000-0000-4000-8000-000000000004','1ea00000-0000-4000-8000-000000000002',3,9000,'Pollo')
      ) as p(id, sector, pos, price, title))),
  '1e100000-0000-4000-8000-000000000001');
select private.ensure_payment_methods((select t1 from scope), (select l1 from scope));

create function pg_temp.line(n integer, product text, quantity integer default 1) returns jsonb language sql as $$
  select jsonb_build_object('lineId', '1ec00000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'),
    'productId', product, 'variantId', null, 'quantity', quantity)
$$;
create function pg_temp.manual(command text, table_id text, items jsonb) returns jsonb language sql as $$
  select private.create_manual_order((select t1 from scope), (select l1 from scope),
    (select manager from staff), command::uuid, table_id::uuid, 'table', null, null, items)
$$;
create function pg_temp.summary(session uuid) returns jsonb language sql as $$
  select private.account_summary((select t1 from scope), (select l1 from scope), session)
$$;
create function pg_temp.pay(staff uuid, command text, session uuid, method text, amount integer default null, tip integer default 0)
returns jsonb language sql as $$
  select private.record_account_payment((select t1 from scope), (select l1 from scope), staff, command::uuid, session, method, amount, tip)
$$;
create function pg_temp.discount(staff uuid, command text, session uuid, kind text, value integer, reason text default 'Cortesía')
returns jsonb language sql as $$
  select private.apply_account_discount((select t1 from scope), (select l1 from scope), staff, command::uuid, session, kind, value, reason)
$$;
create function pg_temp.keep(staff uuid, command text, session uuid) returns jsonb language sql as $$
  select private.keep_account_open((select t1 from scope), (select l1 from scope), staff, command::uuid, session)
$$;
create function pg_temp.accounts(staff uuid) returns jsonb language sql as $$
  select private.waiter_accounts_view((select t1 from scope), (select l1 from scope), staff)
$$;
create function pg_temp.session_of(wanted text) returns uuid language sql as $$
  select s.id from private.table_sessions s
  where s.status = 'open' and s.scope_key = coalesce(
    (select m.group_id from private.floor_group_members m where m.table_id = wanted::uuid), wanted::uuid)
$$;

-- Privileges ---------------------------------------------------------------
select ok(
  not has_table_privilege('authenticator', 'private.account_entries', 'select')
    and not has_table_privilege('authenticator', 'private.account_entries', 'insert')
    and not has_table_privilege('authenticator', 'private.table_sessions', 'select')
    and not has_table_privilege('authenticator', 'private.account_decisions', 'insert'),
  'the runtime role cannot touch the ledger tables directly');
select ok(
  has_function_privilege('authenticator', 'private.waiter_accounts_view(uuid,uuid,uuid)', 'execute')
    and has_function_privilege('authenticator', 'private.record_account_payment(uuid,uuid,uuid,uuid,uuid,text,integer,integer)', 'execute')
    and has_function_privilege('authenticator', 'private.apply_account_discount(uuid,uuid,uuid,uuid,uuid,text,integer,text)', 'execute')
    and has_function_privilege('authenticator', 'private.keep_account_open(uuid,uuid,uuid,uuid,uuid)', 'execute'),
  'the runtime role executes the four scoped entry points');
select ok(
  not has_function_privilege('authenticator', 'private.ensure_table_session(uuid,uuid,uuid,uuid)', 'execute')
    and not has_function_privilege('authenticator', 'private.account_summary(uuid,uuid,uuid)', 'execute')
    and not has_function_privilege('authenticator', 'private.verify_account(uuid,uuid,uuid)', 'execute'),
  'internal helpers are not reachable by the runtime role');

-- Sessions and the occupied table ---------------------------------------------
create temporary table o1 as select (pg_temp.manual('1ed00000-0000-4000-8000-000000000001', '1e600000-0000-4000-8000-000000000001',
  jsonb_build_array(pg_temp.line(1, '1eb00000-0000-4000-8000-000000000001', 2), pg_temp.line(2, '1eb00000-0000-4000-8000-000000000002')))->>'orderId')::uuid id;
select is((select count(*)::int from private.table_sessions where status = 'open'), 1, 'confirming the first order opens one table session');
select is((select state from private.floor_table_service_states where table_id = '1e600000-0000-4000-8000-000000000001'), 'occupied',
  'the table becomes occupied');
select is((select session_id is not null from private.confirmed_orders where id = (select id from o1)), true, 'the confirmed order points at its session');
create temporary table o2 as select (pg_temp.manual('1ed00000-0000-4000-8000-000000000002', '1e600000-0000-4000-8000-000000000001',
  jsonb_build_array(pg_temp.line(3, '1eb00000-0000-4000-8000-000000000004')))->>'orderId')::uuid id;
select is((select count(*)::int from private.table_sessions where status = 'open'), 1, 'a second order on the same table joins the open session');
select is((select count(distinct session_id)::int from private.confirmed_orders), 1, 'both orders share the session');
create temporary table o3 as select (pg_temp.manual('1ed00000-0000-4000-8000-000000000003', '1e600000-0000-4000-8000-000000000002',
  jsonb_build_array(pg_temp.line(4, '1eb00000-0000-4000-8000-000000000002')))->>'orderId')::uuid id;
create temporary table o4 as select (pg_temp.manual('1ed00000-0000-4000-8000-000000000004', '1e600000-0000-4000-8000-000000000003',
  jsonb_build_array(pg_temp.line(5, '1eb00000-0000-4000-8000-000000000002')))->>'orderId')::uuid id;
select is((select count(*)::int from private.table_sessions where status = 'open'), 2, 'a table group shares one session across its tables');
select is((select (select session_id from private.confirmed_orders where id = (select id from o3)) = (select session_id from private.confirmed_orders where id = (select id from o4))), true,
  'orders of two grouped tables land on the same account');
select is((select count(*)::int from private.table_sessions where group_id is not null), 1, 'the grouped session records its group');
select throws_ok($$ delete from private.table_sessions $$, 'PT209', null, 'sessions are never deleted');

-- Charges ----------------------------------------------------------------------
select is((select count(*)::int from private.account_entries where kind = 'charge'), 5, 'every confirmed item is charged once');
select is((select sum(amount_cents)::int from private.account_entries where kind = 'charge'), 25000 + 4000 + 9000 + 4000 + 4000,
  'the charges add up to the confirmed items');
select results_eq(
  $$ select amount_cents, origin, currency from private.account_entries
     where source_id = '1ec00000-0000-4000-8000-000000000001' $$,
  $$ values (25000, 'order_confirmed'::text, 'ARS'::text) $$,
  'a charge keeps its amount, origin and currency');
select is((select count(*)::int from private.account_entries where tenant_id <> (select t1 from scope) or location_id <> (select l1 from scope)), 0,
  'every movement carries its tenant and location');
select is((select count(*)::int from private.account_entries where actor_id is null or actor_type is null or cause is null or length(cause) = 0), 0,
  'every movement carries an actor and a cause');
select is((select (pg_temp.summary(pg_temp.session_of('1e600000-0000-4000-8000-000000000001')) ->> 'consumedCents')::int), 38000,
  'the consumed amount is derived from the ledger');
select is((select (pg_temp.summary(pg_temp.session_of('1e600000-0000-4000-8000-000000000001')) ->> 'pendingCents')::int), 38000, 'nothing is paid yet');
select throws_ok($$ insert into private.account_entries (tenant_id, location_id, session_id, kind, amount_cents, origin, cause, actor_type)
  values ((select t1 from scope), (select l1 from scope), pg_temp.session_of('1e600000-0000-4000-8000-000000000001'), 'charge', 100, 'order_confirmed', 'dup', 'system') $$,
  null, null, 'a charge without a source is refused');
select throws_ok($$ insert into private.account_entries (tenant_id, location_id, session_id, kind, amount_cents, origin, cause, actor_type, source_type, source_id)
  values ((select t1 from scope), (select l1 from scope), pg_temp.session_of('1e600000-0000-4000-8000-000000000001'), 'charge', -5, 'order_confirmed', 'neg', 'system', 'confirmed_order_item', gen_random_uuid()) $$,
  '23514', null, 'a charge can never be negative');
select throws_ok($$ insert into private.account_entries (tenant_id, location_id, session_id, kind, amount_cents, origin, cause, actor_type, source_type, source_id)
  values ((select t1 from scope), (select l1 from scope), pg_temp.session_of('1e600000-0000-4000-8000-000000000001'), 'payment', 5, 'payment', 'pos', 'system', 'payment', gen_random_uuid()) $$,
  '23514', null, 'a payment can never be positive');
select throws_ok($$ insert into private.account_entries (tenant_id, location_id, session_id, kind, amount_cents, origin, cause, actor_type, source_type, source_id)
  values ((select t1 from scope), (select l1 from scope), pg_temp.session_of('1e600000-0000-4000-8000-000000000001'), 'tip', 0, 'manual', 'zero', 'system', 'payment', gen_random_uuid()) $$,
  '23514', null, 'a movement is never zero');
select throws_ok($$ update private.account_entries set amount_cents = 1 $$, 'PT209', null, 'the ledger cannot be rewritten');
select throws_ok($$ delete from private.account_entries $$, 'PT209', null, 'the ledger cannot be deleted from');
select throws_ok($$ truncate private.account_entries $$, 'PT209', null, 'the ledger cannot be truncated');

-- Cancellations and replacements move the balance through the ledger -------------
create function pg_temp.adv(staff uuid, command text, order_id uuid, line text, to_status text) returns jsonb language sql as $$
  select private.advance_production_item((select t1 from scope), (select l1 from scope), staff, command::uuid, order_id, line::uuid, to_status)
$$;
create function pg_temp.exc(staff uuid, command text, order_id uuid, line text, reason text default 'Se terminó') returns jsonb language sql as $$
  select private.report_production_exception((select t1 from scope), (select l1 from scope), staff, command::uuid, order_id, line::uuid, reason)
$$;
create function pg_temp.propose(staff uuid, command text, order_id uuid, line text, product text) returns jsonb language sql as $$
  select private.propose_item_replacement((select t1 from scope), (select l1 from scope), staff, command::uuid, order_id, line::uuid, product::uuid, null)
$$;
create function pg_temp.decide(staff uuid, command text, adjustment uuid, decision text) returns jsonb language sql as $$
  select private.decide_item_replacement((select t1 from scope), (select l1 from scope), staff, command::uuid, adjustment, decision, null)
$$;
create function pg_temp.cancel(staff uuid, command text, order_id uuid, line text, reason text default 'Sin reemplazo') returns jsonb language sql as $$
  select private.cancel_order_item((select t1 from scope), (select l1 from scope), staff, command::uuid, order_id, line::uuid, reason)
$$;

create temporary table s1 as select pg_temp.session_of('1e600000-0000-4000-8000-000000000001') id;
create temporary table sg as select pg_temp.session_of('1e600000-0000-4000-8000-000000000002') id;

-- A cancelled item reverses its charge ----------------------------------------------
select pg_temp.exc((select kitchen from staff), '1ee00000-0000-4000-8000-000000000001', (select id from o2), '1ec00000-0000-4000-8000-000000000003', 'Se quemó');
create temporary table c1 as select pg_temp.cancel((select manager from staff), '1ee00000-0000-4000-8000-000000000002', (select id from o2), '1ec00000-0000-4000-8000-000000000003') result;
select is((select (pg_temp.summary((select id from s1)) ->> 'consumedCents')::int), 29000, 'a cancellation lowers the consumed amount');
select results_eq(
  $$ select kind, amount_cents, origin, source_type from private.account_entries
     where source_id = (select (result ->> 'adjustmentId')::uuid from c1) $$,
  $$ values ('adjustment'::text, -9000, 'item_cancelled'::text, 'order_adjustment'::text) $$,
  'the reversal is linked to the cancellation adjustment');
select is((select count(*)::int from private.account_entries where source_id = '1ec00000-0000-4000-8000-000000000003'), 1,
  'the original charge is kept, never deleted');

-- A replacement moves the balance by its linked difference --------------------------
select pg_temp.exc((select bar from staff), '1ee00000-0000-4000-8000-000000000003', (select id from o1), '1ec00000-0000-4000-8000-000000000002');
create temporary table p1 as select pg_temp.propose((select ana from staff), '1ee00000-0000-4000-8000-000000000004', (select id from o1), '1ec00000-0000-4000-8000-000000000002', '1eb00000-0000-4000-8000-000000000003') result;
select is((select (pg_temp.summary((select id from s1)) ->> 'consumedCents')::int), 29000, 'a proposal does not touch the account');
create temporary table a1 as select pg_temp.decide((select ana from staff), '1ee00000-0000-4000-8000-000000000005', (select (result ->> 'adjustmentId')::uuid from p1), 'accept') result;
select is((select (pg_temp.summary((select id from s1)) ->> 'consumedCents')::int), 31900, 'an accepted replacement adds its difference');
select results_eq(
  $$ select kind, amount_cents, origin from private.account_entries
     where source_id = (select (result ->> 'adjustmentId')::uuid from p1) $$,
  $$ values ('adjustment'::text, -4000, 'item_replaced'::text) $$,
  'the original item is reversed against the replacement adjustment');
select is((select amount_cents from private.account_entries where source_id = (select (result ->> 'replacementLineId')::uuid from a1)), 6900,
  'the replacement line is charged at its own price');
select is((select (difference_cents = (select sum(amount_cents) from private.account_entries e
    where e.source_id = adj.id or e.source_id = adj.replacement_line_id))
  from private.order_adjustments adj where adj.id = (select (result ->> 'adjustmentId')::uuid from p1)), true,
  'the adjustment difference equals its ledger movements');

-- Payments -------------------------------------------------------------------------------
select throws_ok($$ select pg_temp.pay((select kitchen from staff), '1ef00000-0000-4000-8000-000000000001', (select id from s1), 'cash', 1000) $$,
  'PT200', null, 'a cook cannot collect');
select throws_ok($$ select pg_temp.pay((select bruno from staff), '1ef00000-0000-4000-8000-000000000002', (select id from s1), 'cash', 1000) $$,
  'PT201', null, 'a waiter cannot collect on a table outside their sectors');
select throws_ok($$ select pg_temp.pay('1e800000-0000-4000-8000-000000000001', '1ef00000-0000-4000-8000-000000000003', (select id from s1), 'cash', 1000) $$,
  'PT200', null, 'staff of another tenant cannot collect');
select throws_ok($$ select pg_temp.pay((select ana from staff), '1ef00000-0000-4000-8000-000000000004', (select id from s1), 'bitcoin', 1000) $$,
  'PT212', null, 'only in-person methods are accepted');
select throws_ok($$ select pg_temp.pay((select ana from staff), '1ef00000-0000-4000-8000-000000000005', (select id from s1), 'cash', 0) $$,
  'PT212', null, 'a payment is never zero');
select throws_ok($$ select pg_temp.pay((select ana from staff), '1ef00000-0000-4000-8000-000000000006', (select id from s1), 'cash', 1000, -1) $$,
  'PT212', null, 'a tip is never negative');
select throws_ok($$ select pg_temp.pay((select ana from staff), '1ef00000-0000-4000-8000-000000000007', (select id from s1), 'cash', 99999999) $$,
  'PT230', null, 'a payment above the pending balance is refused');
create temporary table pay1 as select pg_temp.pay((select ana from staff), '1ef00000-0000-4000-8000-000000000008', (select id from s1), 'cash', 10000, 500) result;
select is((select (result ->> 'paymentCents')::int from pay1), 10500, 'a payment includes its tip');
select is((select (result ->> 'tipCents')::int from pay1), 500, 'the tip is reported');
select is((select (result ->> 'pendingCents')::int from pay1), 21900, 'the pending balance drops by the amount, not the tip');
select results_eq(
  $$ select kind, amount_cents, payment_method from private.account_entries
     where session_id = (select id from s1) and kind in ('tip', 'payment') order by id $$,
  $$ values ('tip'::text, 500, null::text), ('payment', -10500, 'cash') $$,
  'the tip and the payment are separate movements with the method');
select is(pg_temp.pay((select ana from staff), '1ef00000-0000-4000-8000-000000000008', (select id from s1), 'cash', 10000, 500),
  (select result from pay1), 'the same payment command replays its stored result');
select is((select count(*)::int from private.account_entries where session_id = (select id from s1) and kind = 'payment'), 1,
  'a replayed payment writes no second movement');
select throws_ok($$ select pg_temp.pay((select ana from staff), '1ef00000-0000-4000-8000-000000000008', (select id from s1), 'cash', 9999, 500) $$,
  'PT100', null, 'a command id cannot be reused for another payment');

-- Discounts ----------------------------------------------------------------------------------
select throws_ok($$ select pg_temp.discount((select ana from staff), '1ef00000-0000-4000-8000-000000000010', (select id from s1), 'percent', 1000) $$,
  'PT222', null, 'a waiter cannot grant a discount');
select throws_ok($$ select pg_temp.discount((select manager from staff), '1ef00000-0000-4000-8000-000000000011', (select id from s1), 'percent', 1000, '  ') $$,
  'PT212', null, 'a discount needs a reason');
select throws_ok($$ select pg_temp.discount((select manager from staff), '1ef00000-0000-4000-8000-000000000012', (select id from s1), 'percent', 10001) $$,
  'PT212', null, 'a percentage above 100% is invalid');
select throws_ok($$ select pg_temp.discount((select manager from staff), '1ef00000-0000-4000-8000-000000000013', (select id from s1), 'amount', 99999999) $$,
  'PT232', null, 'a discount above the pending balance is refused');
create temporary table disc1 as select pg_temp.discount((select manager from staff), '1ef00000-0000-4000-8000-000000000014', (select id from s1), 'percent', 1000, 'Cliente frecuente') result;
select is((select (result ->> 'discountCents')::int from disc1), 2190, 'a percentage discount rounds half up on the pending balance');
select is((select (result ->> 'pendingCents')::int from disc1), 19710, 'the pending balance drops by the discount');
select is((select amount_cents from private.account_entries where session_id = (select id from s1) and kind = 'discount'), -2190, 'the discount is a negative movement');
select is(pg_temp.discount((select manager from staff), '1ef00000-0000-4000-8000-000000000014', (select id from s1), 'percent', 1000, 'Cliente frecuente'),
  (select result from disc1), 'the same discount command replays its stored result');

-- Collecting the rest -----------------------------------------------------------------------------
create temporary table pay2 as select pg_temp.pay((select ana from staff), '1ef00000-0000-4000-8000-000000000020', (select id from s1), 'credit_card') result;
select is((select (result ->> 'paymentCents')::int from pay2), 19710, 'no amount means the whole pending balance');
select is((select (result ->> 'pendingCents')::int from pay2), 0, 'the account is settled');
select throws_ok($$ select pg_temp.pay((select ana from staff), '1ef00000-0000-4000-8000-000000000021', (select id from s1), 'cash', 100) $$,
  'PT231', null, 'a settled account has nothing to collect');
select results_eq(
  $$ select (s ->> 'consumedCents')::int, (s ->> 'discountCents')::int, (s ->> 'tipCents')::int, (s ->> 'paidCents')::int, (s ->> 'pendingCents')::int
     from (select pg_temp.summary((select id from s1)) s) q $$,
  $$ values (31900, 2190, 500, 30210, 0) $$,
  'consumed, discounts, tips, paid and pending all derive from the ledger');
select is((select (private.verify_account((select t1 from scope), (select l1 from scope), (select id from s1)) ->> 'matches')::boolean), true,
  'recomputing the consumption from the confirmed items gives the same balance');
select is((select count(*)::int from private.account_entries
  where (kind in ('charge', 'tip', 'refund') and amount_cents <= 0) or (kind in ('discount', 'payment') and amount_cents >= 0)), 0,
  'no movement has the wrong sign');

-- Keeping an account open ----------------------------------------------------------------------------
select throws_ok($$ select pg_temp.keep((select kitchen from staff), '1ef00000-0000-4000-8000-000000000030', (select id from sg)) $$,
  'PT200', null, 'a cook cannot decide about an account');
select is((select (select count(*)::int from private.account_entries where session_id = (select id from sg))), 2, 'the grouped account holds its two charges');
create temporary table keep1 as select pg_temp.keep((select ana from staff), '1ef00000-0000-4000-8000-000000000031', (select id from sg)) result;
select is((select result ->> 'decision' from keep1), 'keep_open', 'the waiter leaves the account open');
select is((select (result ->> 'pendingCents')::int from keep1), 8000, 'the open balance is reported');
select is((select count(*)::int from private.account_entries where session_id = (select id from sg)), 2, 'keeping it open moves no money');
select is(pg_temp.keep((select ana from staff), '1ef00000-0000-4000-8000-000000000031', (select id from sg)), (select result from keep1), 'the decision replays');
select is((select count(*)::int from private.account_decisions where session_id = (select id from sg)), 1, 'the decision is recorded once');
select throws_ok($$ update private.account_decisions set decision = 'keep_open' $$, 'PT209', null, 'decisions are append-only');

-- The waiter view ---------------------------------------------------------------------------------------
select is((select jsonb_array_length(pg_temp.accounts((select ana from staff)) -> 'accounts')), 2, 'a waiter sees the accounts of their tables and groups');
select is((select jsonb_array_length(pg_temp.accounts((select bruno from staff)) -> 'accounts')), 1, 'a waiter of another sector sees only the shared group');
select is((select jsonb_array_length(pg_temp.accounts((select manager from staff)) -> 'accounts')), 2, 'a manager sees every open account');
select throws_ok($$ select pg_temp.accounts((select kitchen from staff)) $$, 'PT200', null, 'a cook has no account view');
select throws_ok($$ select pg_temp.accounts('1e800000-0000-4000-8000-000000000001') $$, 'PT200', null, 'staff of another tenant has no view of this location');
select is((select a -> 'summary' ->> 'pendingCents' from jsonb_array_elements(pg_temp.accounts((select ana from staff)) -> 'accounts') a
  where (a ->> 'sessionId')::uuid = (select id from sg)), '8000', 'the view carries the derived balance');
select is((select (a ->> 'keptOpen')::boolean from jsonb_array_elements(pg_temp.accounts((select ana from staff)) -> 'accounts') a
  where (a ->> 'sessionId')::uuid = (select id from sg)), true, 'the view shows that the account was left open');
select results_eq(
  $$ select l from (select jsonb_array_elements_text(a -> 'tableLabels') l from jsonb_array_elements(pg_temp.accounts((select ana from staff)) -> 'accounts') a
     where (a ->> 'sessionId')::uuid = (select id from sg)) q order by 1 $$,
  $$ values ('2'::text), ('3') $$,
  'a grouped account names every table of its group');
select is((select jsonb_array_length(a -> 'entries') from jsonb_array_elements(pg_temp.accounts((select ana from staff)) -> 'accounts') a
  where (a ->> 'sessionId')::uuid = (select id from s1)), 10, 'the view lists the movements of the account');

-- Rounding properties ---------------------------------------------------------------------------------------
select is((select count(*)::int
  from generate_series(0, 10000, 37) bp, generate_series(1, 90000, 997) base
  where private.discount_cents_for_percent(base, bp) not between 0 and base), 0,
  'a percentage discount never exceeds its base nor goes negative');
select is((select count(*)::int
  from generate_series(0, 10000, 37) bp, generate_series(1, 90000, 997) base
  where abs(private.discount_cents_for_percent(base, bp)::numeric * 10000 - base::numeric * bp) > 5000), 0,
  'a percentage discount is never more than half a cent from the exact value');
select is((select count(*)::int
  from generate_series(0, 9999) bp
  where private.discount_cents_for_percent(777, bp) > private.discount_cents_for_percent(777, bp + 1)), 0,
  'a bigger percentage never gives a smaller discount');
select is((select count(*)::int
  from generate_series(0, 10000, 53) bp, generate_series(1, 90000, 991) base
  where abs(private.discount_cents_for_percent(base, bp) + private.discount_cents_for_percent(base, 10000 - bp) - base) > 1), 0,
  'a discount and its complement add up to the base within one cent');

-- Audit and immutability ----------------------------------------------------------------------------------------
select is((select count(*)::int from private.audit_events where action = 'account.payment_recorded'), 2, 'every payment is audited');
select is((select count(*)::int from private.audit_events where action = 'account.discount_applied'), 1, 'every discount is audited');
select is((select count(*)::int from private.audit_events where action = 'account.kept_open'), 1, 'keeping an account open is audited');
select throws_ok($$ update private.confirmed_orders set total_cents = 1 $$, 'PT209', null, 'confirmed orders stay append-only');
select is((select count(*)::int from private.audit_events where action in ('account.payment_recorded', 'account.discount_applied')
  and (reason ~* 'pin|token' )), 0, 'the audit never holds secrets');

select * from finish();
rollback;
