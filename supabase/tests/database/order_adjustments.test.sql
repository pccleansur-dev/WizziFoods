begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(76);

insert into auth.users (id) values ('1b100000-0000-4000-8000-000000000001'), ('1b100000-0000-4000-8000-000000000002');
insert into public.tenants (id, slug, name, status) values
  ('1b200000-0000-4000-8000-000000000001', 'adj-one', 'Adj One', 'active'),
  ('1b200000-0000-4000-8000-000000000002', 'adj-two', 'Adj Two', 'active');
insert into public.tenant_memberships (tenant_id, user_id, role)
values ('1b200000-0000-4000-8000-000000000001', '1b100000-0000-4000-8000-000000000001', 'admin'),
  ('1b200000-0000-4000-8000-000000000002', '1b100000-0000-4000-8000-000000000002', 'admin');

create temporary table scope as select
  '1b200000-0000-4000-8000-000000000001'::uuid t1,
  (select id from public.locations where tenant_id = '1b200000-0000-4000-8000-000000000001') l1,
  '1b200000-0000-4000-8000-000000000002'::uuid t2,
  (select id from public.locations where tenant_id = '1b200000-0000-4000-8000-000000000002') l2;

-- Two sectors (S1: table 1, S2: table 2), one waiter each.
select private.save_floor_plan(
  (select t1 from scope), (select l1 from scope),
  '1b100000-0000-4000-8000-000000000001',
  '1b300000-0000-4000-8000-000000000001', 0,
  jsonb_build_object(
    'floors', jsonb_build_array(jsonb_build_object(
      'id','1b400000-0000-4000-8000-000000000001','name','Planta baja','position',0,'shortName',null)),
    'sectors', jsonb_build_array(
      jsonb_build_object('id','1b500000-0000-4000-8000-000000000001','name','Salón','position',0),
      jsonb_build_object('id','1b500000-0000-4000-8000-000000000002','name','Terraza','position',1)),
    'tables', (
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'label', t.label, 'sectorId', t.sector,
        'floorId','1b400000-0000-4000-8000-000000000001','shape','square',
        'x', t.x,'y',40,'width',100,'height',100,'rotation',0,'seatCount',4,
        'seatLayout','perimeter'))
      from (values
        ('1b600000-0000-4000-8000-000000000001','1','1b500000-0000-4000-8000-000000000001',40),
        ('1b600000-0000-4000-8000-000000000002','2','1b500000-0000-4000-8000-000000000002',200)
      ) as t(id, label, sector, x)),
    'groups', '[]'::jsonb
  )
);

create function pg_temp.member(username text, role text, sectors uuid[] default '{}')
returns uuid language sql as $$
  select (private.create_staff_member(
    (select t1 from scope), (select l1 from scope),
    '1b100000-0000-4000-8000-000000000001',
    username, initcap(username), role, 'scrypt-v1$c2FsdA$aGFzaA', sectors) ->> 'id')::uuid
$$;
create temporary table staff as select
  pg_temp.member('ana', 'waiter', array['1b500000-0000-4000-8000-000000000001'::uuid]) ana,
  pg_temp.member('bruno', 'waiter', array['1b500000-0000-4000-8000-000000000002'::uuid]) bruno,
  pg_temp.member('marta', 'manager') manager,
  pg_temp.member('coco', 'kitchen') kitchen,
  pg_temp.member('beto', 'bar') bar;
insert into public.staff_members (id, tenant_id, location_id, username, display_name, role, created_by)
values ('1b800000-0000-4000-8000-000000000001', (select t2 from scope), (select l2 from scope),
  'otra', 'Otra', 'kitchen', '1b100000-0000-4000-8000-000000000001'),
  ('1b800000-0000-4000-8000-000000000002', (select t2 from scope), (select l2 from scope),
  'otro', 'Otro', 'waiter', '1b100000-0000-4000-8000-000000000001');

insert into private.location_publications (tenant_id, location_id, published_by)
values ((select t1 from scope), (select l1 from scope), '1b100000-0000-4000-8000-000000000001');

-- Milanesa and Pollo (kitchen), Cerveza and Vino (bar, with a Reserva variant).
insert into private.published_catalogs (
  tenant_id, location_id, revision, source_draft_revision, snapshot, published_by
) values (
  (select t1 from scope), (select l1 from scope), 1, 1,
  jsonb_build_object(
    'baseRevision', null,
    'categories', jsonb_build_array(jsonb_build_object(
      'id','1ba00000-0000-4000-8000-000000000001','position',0,
      'content',jsonb_build_array(jsonb_build_object('language','es','title','Todo','description','')))),
    'sectors', jsonb_build_array(
      jsonb_build_object('id','1ba00000-0000-4000-8000-000000000002','position',0,'name','Cocina','kind','kitchen'),
      jsonb_build_object('id','1ba00000-0000-4000-8000-000000000003','position',1,'name','Barra','kind','bar')),
    'products', (
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'categoryId','1ba00000-0000-4000-8000-000000000001',
        'sectorId', p.sector, 'position', p.pos, 'priceCents', p.price, 'imageAssetId', null,
        'content', jsonb_build_array(jsonb_build_object('language','es','title',p.title,'description','')),
        'variants', case when p.title = 'Vino' then jsonb_build_array(jsonb_build_object(
          'id','1bb00000-0000-4000-8000-0000000000a1','position',0,'priceDeltaCents',1500,
          'content',jsonb_build_array(jsonb_build_object('language','es','title','Reserva','description','')))) else '[]'::jsonb end))
      from (values
        ('1bb00000-0000-4000-8000-000000000001','1ba00000-0000-4000-8000-000000000002',0,12500,'Milanesa'),
        ('1bb00000-0000-4000-8000-000000000002','1ba00000-0000-4000-8000-000000000003',1,4000,'Cerveza'),
        ('1bb00000-0000-4000-8000-000000000003','1ba00000-0000-4000-8000-000000000003',2,6900,'Vino'),
        ('1bb00000-0000-4000-8000-000000000004','1ba00000-0000-4000-8000-000000000002',3,9000,'Pollo')
      ) as p(id, sector, pos, price, title))),
  '1b100000-0000-4000-8000-000000000001');
insert into private.product_operational_stock (tenant_id, location_id, product_id, available_quantity)
values ((select t1 from scope), (select l1 from scope), '1bb00000-0000-4000-8000-000000000002', 10),
  ((select t1 from scope), (select l1 from scope), '1bb00000-0000-4000-8000-000000000003', 5);

create function pg_temp.line(n integer, product text, quantity integer default 1, variant text default null) returns jsonb language sql as $$
  select jsonb_build_object('lineId', '1bc00000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'),
    'productId', product, 'variantId', variant, 'quantity', quantity)
$$;
create function pg_temp.manual(command text, table_id text, items jsonb, by uuid default null) returns jsonb language sql as $$
  select private.create_manual_order((select t1 from scope), (select l1 from scope),
    coalesce(by, (select manager from staff)), command::uuid, table_id::uuid, 'table', null, null, items)
$$;
create function pg_temp.adv(staff uuid, command text, order_id uuid, line text, to_status text) returns jsonb language sql as $$
  select private.advance_production_item((select t1 from scope), (select l1 from scope), staff, command::uuid, order_id, line::uuid, to_status)
$$;
create function pg_temp.deliver(staff uuid, command text, order_id uuid, line text) returns jsonb language sql as $$
  select private.deliver_order_item((select t1 from scope), (select l1 from scope), staff, command::uuid, order_id, line::uuid)
$$;
create function pg_temp.exc(staff uuid, command text, order_id uuid, line text, reason text default 'Se terminó') returns jsonb language sql as $$
  select private.report_production_exception((select t1 from scope), (select l1 from scope), staff, command::uuid, order_id, line::uuid, reason)
$$;
create function pg_temp.propose(staff uuid, command text, order_id uuid, line text, product text, variant text default null) returns jsonb language sql as $$
  select private.propose_item_replacement((select t1 from scope), (select l1 from scope), staff, command::uuid, order_id, line::uuid, product::uuid, variant::uuid)
$$;
create function pg_temp.decide(staff uuid, command text, adjustment uuid, decision text, reason text default null) returns jsonb language sql as $$
  select private.decide_item_replacement((select t1 from scope), (select l1 from scope), staff, command::uuid, adjustment, decision, reason)
$$;
create function pg_temp.cancel(staff uuid, command text, order_id uuid, line text, reason text default 'El cliente se fue') returns jsonb language sql as $$
  select private.cancel_order_item((select t1 from scope), (select l1 from scope), staff, command::uuid, order_id, line::uuid, reason)
$$;
create function pg_temp.orders(staff uuid) returns jsonb language sql as $$
  select private.waiter_orders_view((select t1 from scope), (select l1 from scope), staff)
$$;
create function pg_temp.item_status(line text) returns text language sql as $$
  select status from private.production_items where line_id = line::uuid
$$;

-- Privileges ---------------------------------------------------------------
select ok(
  not has_table_privilege('authenticator', 'private.order_adjustments', 'select')
    and not has_table_privilege('authenticator', 'private.order_adjustments', 'insert'),
  'the runtime role cannot touch the adjustments table directly');
select ok(
  has_function_privilege('authenticator', 'private.deliver_order_item(uuid,uuid,uuid,uuid,uuid,uuid)', 'execute')
    and has_function_privilege('authenticator', 'private.report_production_exception(uuid,uuid,uuid,uuid,uuid,uuid,text)', 'execute')
    and has_function_privilege('authenticator', 'private.propose_item_replacement(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid)', 'execute')
    and has_function_privilege('authenticator', 'private.decide_item_replacement(uuid,uuid,uuid,uuid,uuid,text,text)', 'execute')
    and has_function_privilege('authenticator', 'private.cancel_order_item(uuid,uuid,uuid,uuid,uuid,uuid,text)', 'execute')
    and has_function_privilege('authenticator', 'private.waiter_orders_view(uuid,uuid,uuid)', 'execute'),
  'the runtime role executes the six scoped entry points');

-- Orders ---------------------------------------------------------------------
-- o1 (table 1, ana): Milanesa x2, Cerveza.   o2 (table 2, bruno): Cerveza.
create temporary table o1 as select (pg_temp.manual('1bd00000-0000-4000-8000-000000000001', '1b600000-0000-4000-8000-000000000001',
  jsonb_build_array(pg_temp.line(1, '1bb00000-0000-4000-8000-000000000001', 2), pg_temp.line(2, '1bb00000-0000-4000-8000-000000000002')))->>'orderId')::uuid id;
create temporary table o2 as select (pg_temp.manual('1bd00000-0000-4000-8000-000000000002', '1b600000-0000-4000-8000-000000000002',
  jsonb_build_array(pg_temp.line(3, '1bb00000-0000-4000-8000-000000000002')))->>'orderId')::uuid id;

-- Delivery -----------------------------------------------------------------
select throws_ok($$ select pg_temp.deliver((select ana from staff), '1be00000-0000-4000-8000-000000000001', (select id from o1), '1bc00000-0000-4000-8000-000000000001') $$,
  'PT221', null, 'a queued item cannot be delivered');
select pg_temp.adv((select kitchen from staff), '1be00000-0000-4000-8000-000000000002', (select id from o1), '1bc00000-0000-4000-8000-000000000001', 'preparing');
select throws_ok($$ select pg_temp.deliver((select ana from staff), '1be00000-0000-4000-8000-000000000003', (select id from o1), '1bc00000-0000-4000-8000-000000000001') $$,
  'PT221', null, 'an item in preparation cannot be delivered');
select pg_temp.adv((select kitchen from staff), '1be00000-0000-4000-8000-000000000004', (select id from o1), '1bc00000-0000-4000-8000-000000000001', 'ready');
select throws_ok($$ select pg_temp.deliver((select kitchen from staff), '1be00000-0000-4000-8000-000000000005', (select id from o1), '1bc00000-0000-4000-8000-000000000001') $$,
  'PT200', null, 'a cook cannot mark an item delivered');
select throws_ok($$ select pg_temp.deliver((select bruno from staff), '1be00000-0000-4000-8000-000000000006', (select id from o1), '1bc00000-0000-4000-8000-000000000001') $$,
  'PT201', null, 'a waiter cannot deliver on a table outside their sectors');
select throws_ok($$ select pg_temp.deliver('1b800000-0000-4000-8000-000000000002', '1be00000-0000-4000-8000-000000000007', (select id from o1), '1bc00000-0000-4000-8000-000000000001') $$,
  'PT200', null, 'staff of another tenant cannot deliver');
create temporary table d1 as select pg_temp.deliver((select ana from staff), '1be00000-0000-4000-8000-000000000008', (select id from o1), '1bc00000-0000-4000-8000-000000000001') result;
select is((select result ->> 'status' from d1), 'delivered', 'the waiter delivers a ready item');
select is((select result ->> 'changed' from d1), 'true', 'the first delivery changes the item');
select is((select result ->> 'orderStatus' from d1), 'in_preparation', 'the order is not delivered while another item is queued');
select is(pg_temp.deliver((select ana from staff), '1be00000-0000-4000-8000-000000000008', (select id from o1), '1bc00000-0000-4000-8000-000000000001'),
  (select result from d1), 'the same delivery command replays its stored result');
select is((select pg_temp.deliver((select manager from staff), '1be00000-0000-4000-8000-000000000009', (select id from o1), '1bc00000-0000-4000-8000-000000000001') ->> 'changed'), 'false',
  'delivering an already delivered item changes nothing');
select is((select count(*)::int from private.production_item_events where line_id = '1bc00000-0000-4000-8000-000000000001' and to_status = 'delivered'), 1,
  'a delivery is recorded once');

-- Exceptions ---------------------------------------------------------------
select throws_ok($$ select pg_temp.exc((select ana from staff), '1be00000-0000-4000-8000-000000000010', (select id from o1), '1bc00000-0000-4000-8000-000000000002') $$,
  'PT200', null, 'a waiter cannot report a production exception');
select throws_ok($$ select pg_temp.exc((select kitchen from staff), '1be00000-0000-4000-8000-000000000011', (select id from o1), '1bc00000-0000-4000-8000-000000000002') $$,
  'PT201', null, 'the kitchen cannot report an exception on a bar item');
select throws_ok($$ select pg_temp.exc((select bar from staff), '1be00000-0000-4000-8000-000000000012', (select id from o1), '1bc00000-0000-4000-8000-000000000002', '') $$,
  'PT212', null, 'an exception needs a reason');
select throws_ok($$ select pg_temp.exc((select kitchen from staff), '1be00000-0000-4000-8000-000000000013', (select id from o1), '1bc00000-0000-4000-8000-000000000001') $$,
  'PT220', null, 'a delivered item cannot become an exception');
create temporary table e1 as select pg_temp.exc((select bar from staff), '1be00000-0000-4000-8000-000000000014', (select id from o1), '1bc00000-0000-4000-8000-000000000002', 'Se terminó la cerveza') result;
select is((select result ->> 'status' from e1), 'exception', 'the bar reports a shortage');
select is((select result ->> 'orderStatus' from e1), 'exception', 'the order derives an exception');
select is(pg_temp.exc((select bar from staff), '1be00000-0000-4000-8000-000000000014', (select id from o1), '1bc00000-0000-4000-8000-000000000002', 'Se terminó la cerveza'),
  (select result from e1), 'the same exception command replays its stored result');
select is((select count(*)::int from private.confirmed_order_items where order_id = (select id from o1)), 2,
  'an exception never deletes the confirmed item');
select is((select available_quantity from private.product_operational_stock where product_id = '1bb00000-0000-4000-8000-000000000002'), 8,
  'an exception keeps the stock already consumed');
select is((select reason from private.production_item_events where line_id = '1bc00000-0000-4000-8000-000000000002' and to_status = 'exception'), 'Se terminó la cerveza',
  'the exception keeps its reason');
select throws_ok($$ select pg_temp.adv((select bar from staff), '1be00000-0000-4000-8000-000000000015', (select id from o1), '1bc00000-0000-4000-8000-000000000002', 'preparing') $$,
  'PT220', null, 'an exception cannot be prepared again');

-- Replacement ----------------------------------------------------------------
select throws_ok($$ select pg_temp.propose((select ana from staff), '1be00000-0000-4000-8000-000000000020', (select id from o1), '1bc00000-0000-4000-8000-000000000001', '1bb00000-0000-4000-8000-000000000004') $$,
  'PT220', null, 'only an item with an exception can be replaced');
select throws_ok($$ select pg_temp.propose((select kitchen from staff), '1be00000-0000-4000-8000-000000000021', (select id from o1), '1bc00000-0000-4000-8000-000000000002', '1bb00000-0000-4000-8000-000000000003') $$,
  'PT200', null, 'a cook cannot propose a replacement');
select throws_ok($$ select pg_temp.propose((select bruno from staff), '1be00000-0000-4000-8000-000000000022', (select id from o1), '1bc00000-0000-4000-8000-000000000002', '1bb00000-0000-4000-8000-000000000003') $$,
  'PT201', null, 'a waiter cannot propose on a table outside their sectors');
select throws_ok($$ select pg_temp.propose((select ana from staff), '1be00000-0000-4000-8000-000000000023', (select id from o1), '1bc00000-0000-4000-8000-000000000002', '1bb00000-0000-4000-8000-0000000000ff') $$,
  'PT104', null, 'a product outside the menu cannot replace an item');
create temporary table p1 as select pg_temp.propose((select ana from staff), '1be00000-0000-4000-8000-000000000024', (select id from o1), '1bc00000-0000-4000-8000-000000000002',
  '1bb00000-0000-4000-8000-000000000003', '1bb00000-0000-4000-8000-0000000000a1') result;
select is((select result ->> 'status' from p1), 'proposed', 'a replacement is proposed, not applied');
select is((select (result ->> 'originalTotalCents')::int from p1), 4000, 'the proposal keeps the original total');
select is((select (result ->> 'replacementTotalCents')::int from p1), 8400, 'the replacement is priced server-side with its variant');
select is((select (result ->> 'differenceCents')::int from p1), 4400, 'the economic difference is linked to the proposal');
select is(pg_temp.item_status('1bc00000-0000-4000-8000-000000000002'), 'exception', 'proposing does not change the item yet');
select throws_ok($$ select pg_temp.propose((select ana from staff), '1be00000-0000-4000-8000-000000000025', (select id from o1), '1bc00000-0000-4000-8000-000000000002', '1bb00000-0000-4000-8000-000000000003') $$,
  'PT224', null, 'an item cannot have two open proposals');
select is(pg_temp.propose((select ana from staff), '1be00000-0000-4000-8000-000000000024', (select id from o1), '1bc00000-0000-4000-8000-000000000002',
  '1bb00000-0000-4000-8000-000000000003', '1bb00000-0000-4000-8000-0000000000a1'), (select result from p1), 'the same proposal command replays its result');
select throws_ok($$ select pg_temp.decide((select kitchen from staff), '1be00000-0000-4000-8000-000000000026', (select (result ->> 'adjustmentId')::uuid from p1), 'accept') $$,
  'PT200', null, 'a cook cannot accept a replacement');
select throws_ok($$ select pg_temp.decide((select ana from staff), '1be00000-0000-4000-8000-000000000027', (select (result ->> 'adjustmentId')::uuid from p1), 'maybe') $$,
  'PT212', null, 'a decision is accept or reject');
-- A price change between the proposal and the acceptance is refused.
update private.published_catalogs set snapshot = jsonb_set(snapshot, '{products,2,priceCents}', '7000') where revision = 1;
select throws_ok($$ select pg_temp.decide((select ana from staff), '1be00000-0000-4000-8000-000000000028', (select (result ->> 'adjustmentId')::uuid from p1), 'accept') $$,
  'PT211', null, 'a changed menu price blocks the acceptance');
update private.published_catalogs set snapshot = jsonb_set(snapshot, '{products,2,priceCents}', '6900') where revision = 1;
create temporary table a1 as select pg_temp.decide((select ana from staff), '1be00000-0000-4000-8000-000000000029', (select (result ->> 'adjustmentId')::uuid from p1), 'accept') result;
select is((select result ->> 'status' from a1), 'accepted', 'the waiter records the diner acceptance');
select is(pg_temp.item_status('1bc00000-0000-4000-8000-000000000002'), 'replaced', 'the original item is replaced');
select is((select status from private.production_items where line_id = (select (result ->> 'replacementLineId')::uuid from a1)), 'queued',
  'the replacement goes to production queued');
select is((select sector_kind from private.production_items where line_id = (select (result ->> 'replacementLineId')::uuid from a1)), 'bar',
  'the replacement keeps routing by sector');
select is((select available_quantity from private.product_operational_stock where product_id = '1bb00000-0000-4000-8000-000000000003'), 4,
  'the replacement reserves its own stock');
select is((select (difference_cents, replacement_line_id is not null)::text from private.order_adjustments where id = (select (result ->> 'adjustmentId')::uuid from p1)),
  '(4400,t)', 'the accepted adjustment links the replacement line and the difference');
select is((select count(*)::int from private.confirmed_orders where id = (select id from o1) and total_cents = 29000), 1,
  'the confirmed order total is never rewritten');
select is(pg_temp.decide((select ana from staff), '1be00000-0000-4000-8000-000000000029', (select (result ->> 'adjustmentId')::uuid from p1), 'accept'),
  (select result from a1), 'the same acceptance command replays its result');
select throws_ok($$ select pg_temp.decide((select ana from staff), '1be00000-0000-4000-8000-000000000030', (select (result ->> 'adjustmentId')::uuid from p1), 'reject', 'Ahora no') $$,
  'PT224', null, 'a decided replacement cannot be decided again');

-- Rejecting keeps the shortage open, then the manager cancels it -----------------
create temporary table o3 as select (pg_temp.manual('1bd00000-0000-4000-8000-000000000003', '1b600000-0000-4000-8000-000000000001',
  jsonb_build_array(pg_temp.line(4, '1bb00000-0000-4000-8000-000000000004'), pg_temp.line(5, '1bb00000-0000-4000-8000-000000000002')))->>'orderId')::uuid id;
select pg_temp.adv((select kitchen from staff), '1be00000-0000-4000-8000-000000000040', (select id from o3), '1bc00000-0000-4000-8000-000000000004', 'preparing');
select pg_temp.exc((select kitchen from staff), '1be00000-0000-4000-8000-000000000041', (select id from o3), '1bc00000-0000-4000-8000-000000000004', 'Se quemó');
create temporary table p2 as select pg_temp.propose((select ana from staff), '1be00000-0000-4000-8000-000000000042', (select id from o3), '1bc00000-0000-4000-8000-000000000004', '1bb00000-0000-4000-8000-000000000001') result;
select is((select (result ->> 'differenceCents')::int from p2), 3500, 'a pricier replacement shows a positive difference');
select is((select pg_temp.decide((select ana from staff), '1be00000-0000-4000-8000-000000000043', (select (result ->> 'adjustmentId')::uuid from p2), 'reject', 'No quiere milanesa') ->> 'status'), 'rejected',
  'the diner can reject a replacement');
select is(pg_temp.item_status('1bc00000-0000-4000-8000-000000000004'), 'exception', 'a rejected replacement leaves the shortage open');
select throws_ok($$ select pg_temp.cancel((select ana from staff), '1be00000-0000-4000-8000-000000000044', (select id from o3), '1bc00000-0000-4000-8000-000000000004') $$,
  'PT222', null, 'a waiter cannot cancel an item');
select throws_ok($$ select pg_temp.cancel((select kitchen from staff), '1be00000-0000-4000-8000-000000000045', (select id from o3), '1bc00000-0000-4000-8000-000000000004') $$,
  'PT222', null, 'a cook cannot cancel an item');
select throws_ok($$ select pg_temp.cancel((select manager from staff), '1be00000-0000-4000-8000-000000000046', (select id from o3), '1bc00000-0000-4000-8000-000000000004', '  ') $$,
  'PT212', null, 'a cancellation needs a reason');
select throws_ok($$ select pg_temp.cancel('1b800000-0000-4000-8000-000000000002', '1be00000-0000-4000-8000-000000000047', (select id from o3), '1bc00000-0000-4000-8000-000000000004') $$,
  'PT200', null, 'staff of another tenant cannot cancel');
create temporary table c1 as select pg_temp.cancel((select manager from staff), '1be00000-0000-4000-8000-000000000048', (select id from o3), '1bc00000-0000-4000-8000-000000000004', 'Sin reemplazo') result;
select is((select result ->> 'status' from c1), 'cancelled', 'the manager cancels the shortage with a reason');
select is((select (result ->> 'differenceCents')::int from c1), -9000, 'the cancellation links a negative difference');
select is(pg_temp.item_status('1bc00000-0000-4000-8000-000000000004'), 'cancelled', 'the item is cancelled');
select is((select count(*)::int from private.confirmed_order_items where order_id = (select id from o3)), 2, 'a cancellation keeps the confirmed item');
select is(pg_temp.cancel((select manager from staff), '1be00000-0000-4000-8000-000000000048', (select id from o3), '1bc00000-0000-4000-8000-000000000004', 'Sin reemplazo'),
  (select result from c1), 'the same cancellation command replays its result');
select throws_ok($$ select pg_temp.cancel((select manager from staff), '1be00000-0000-4000-8000-000000000049', (select id from o3), '1bc00000-0000-4000-8000-000000000004') $$,
  'PT220', null, 'a cancelled item cannot be cancelled again');
-- Cancelling while in preparation is a manager decision.
select pg_temp.adv((select bar from staff), '1be00000-0000-4000-8000-000000000050', (select id from o3), '1bc00000-0000-4000-8000-000000000005', 'preparing');
select is((select pg_temp.cancel((select manager from staff), '1be00000-0000-4000-8000-000000000051', (select id from o3), '1bc00000-0000-4000-8000-000000000005', 'Cambió de idea') ->> 'orderStatus'), 'cancelled',
  'cancelling every item cancels the order');
select throws_ok($$ select pg_temp.cancel((select manager from staff), '1be00000-0000-4000-8000-000000000052', (select id from o1), '1bc00000-0000-4000-8000-000000000001') $$,
  'PT220', null, 'a delivered item cannot be cancelled');

-- Waiter view --------------------------------------------------------------------
select is((select jsonb_array_length(pg_temp.orders((select ana from staff)) -> 'orders')), 1,
  'a waiter sees the open orders of their tables only');
select is((select jsonb_array_length(pg_temp.orders((select bruno from staff)) -> 'orders')), 1, 'the other waiter sees their own table');
select is((select jsonb_array_length(pg_temp.orders((select manager from staff)) -> 'orders')), 2, 'a manager sees every order of the location');
select throws_ok($$ select pg_temp.orders((select kitchen from staff)) $$, 'PT200', null, 'a cook has no waiter order view');
select results_eq(
  $$ select i ->> 'title', i ->> 'status' from jsonb_array_elements(pg_temp.orders((select ana from staff)) -> 'orders' -> 0 -> 'items') i order by 1 $$,
  $$ values ('Cerveza'::text, 'replaced'::text), ('Milanesa', 'delivered'), ('Vino', 'queued') $$,
  'the view shows every item with its state, replaced ones included') ;
select is((select i -> 'adjustment' ->> 'differenceCents' from jsonb_array_elements(pg_temp.orders((select ana from staff)) -> 'orders' -> 0 -> 'items') i where i ->> 'status' = 'replaced'), '4400',
  'a replaced item shows its linked difference');

-- Immutability -----------------------------------------------------------------------
select throws_ok($$ update private.production_items set status = 'delivered' where status = 'queued' $$, 'PT209', null, 'an item cannot skip to delivered');
select throws_ok($$ update private.production_items set status = 'queued' where status = 'delivered' $$, 'PT209', null, 'a delivered item cannot go back');
select throws_ok($$ update private.production_items set status = 'preparing' where status = 'cancelled' $$, 'PT209', null, 'a cancelled item cannot resume');
select throws_ok($$ delete from private.production_item_events $$, 'PT209', null, 'item history is append-only');
select throws_ok($$ update private.order_adjustments set difference_cents = 0 $$, 'PT209', null, 'adjustments cannot be rewritten');
select throws_ok($$ delete from private.order_adjustments $$, 'PT209', null, 'adjustments are never deleted');
select throws_ok($$ update private.confirmed_orders set total_cents = 1 $$, 'PT209', null, 'confirmed orders stay append-only');

-- Audit ---------------------------------------------------------------------------------
select is((select count(*)::int from private.audit_events where action in ('order_item.delivered', 'production.exception_reported',
  'order_item.replacement_proposed', 'order_item.replacement_accepted', 'order_item.replacement_rejected', 'order_item.cancelled')), 9,
  'every real change is audited exactly once');

select * from finish();
rollback;
