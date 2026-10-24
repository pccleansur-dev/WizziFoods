begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(47);

insert into auth.users (id) values ('1a100000-0000-4000-8000-000000000001'), ('1a100000-0000-4000-8000-000000000002');
insert into public.tenants (id, slug, name, status) values
  ('1a200000-0000-4000-8000-000000000001', 'prod-one', 'Prod One', 'active'),
  ('1a200000-0000-4000-8000-000000000002', 'prod-two', 'Prod Two', 'active');
insert into public.tenant_memberships (tenant_id, user_id, role)
values ('1a200000-0000-4000-8000-000000000001', '1a100000-0000-4000-8000-000000000001', 'admin'),
  ('1a200000-0000-4000-8000-000000000002', '1a100000-0000-4000-8000-000000000002', 'admin');

create temporary table scope as select
  '1a200000-0000-4000-8000-000000000001'::uuid t1,
  (select id from public.locations where tenant_id = '1a200000-0000-4000-8000-000000000001') l1,
  '1a200000-0000-4000-8000-000000000002'::uuid t2,
  (select id from public.locations where tenant_id = '1a200000-0000-4000-8000-000000000002') l2;

-- One sector, two tables.
select private.save_floor_plan(
  (select t1 from scope), (select l1 from scope),
  '1a100000-0000-4000-8000-000000000001',
  '1a300000-0000-4000-8000-000000000001', 0,
  jsonb_build_object(
    'floors', jsonb_build_array(jsonb_build_object(
      'id','1a400000-0000-4000-8000-000000000001','name','Planta baja','position',0,'shortName',null)),
    'sectors', jsonb_build_array(
      jsonb_build_object('id','1a500000-0000-4000-8000-000000000001','name','Salón','position',0)),
    'tables', (
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'label', t.label, 'sectorId','1a500000-0000-4000-8000-000000000001',
        'floorId','1a400000-0000-4000-8000-000000000001','shape','square',
        'x', t.x,'y',40,'width',100,'height',100,'rotation',0,'seatCount',4,
        'seatLayout','perimeter'))
      from (values
        ('1a600000-0000-4000-8000-000000000001','1',40),
        ('1a600000-0000-4000-8000-000000000002','2',200)
      ) as t(id, label, x)),
    'groups', '[]'::jsonb
  )
);

create function pg_temp.member(username text, role text, sectors uuid[] default '{}')
returns uuid language sql as $$
  select (private.create_staff_member(
    (select t1 from scope), (select l1 from scope),
    '1a100000-0000-4000-8000-000000000001',
    username, initcap(username), role, 'scrypt-v1$c2FsdA$aGFzaA', sectors) ->> 'id')::uuid
$$;
create temporary table staff as select
  pg_temp.member('ana', 'waiter', array['1a500000-0000-4000-8000-000000000001'::uuid]) waiter,
  pg_temp.member('marta', 'manager') manager,
  pg_temp.member('coco', 'kitchen') kitchen,
  pg_temp.member('coco2', 'kitchen') kitchen2,
  pg_temp.member('beto', 'bar') bar;
-- Kitchen staff of the second tenant.
insert into public.staff_members (id, tenant_id, location_id, username, display_name, role, created_by)
values ('1a800000-0000-4000-8000-000000000001', (select t2 from scope), (select l2 from scope),
  'otra', 'Otra', 'kitchen', '1a100000-0000-4000-8000-000000000001');

insert into private.location_publications (tenant_id, location_id, published_by)
values ((select t1 from scope), (select l1 from scope), '1a100000-0000-4000-8000-000000000001');

-- Kitchen product (Milanesa), bar product (Cerveza) and a product of an "other" sector.
insert into private.published_catalogs (
  tenant_id, location_id, revision, source_draft_revision, snapshot, published_by
) values (
  (select t1 from scope), (select l1 from scope), 1, 1,
  jsonb_build_object(
    'baseRevision', null,
    'categories', jsonb_build_array(jsonb_build_object(
      'id','1aa00000-0000-4000-8000-000000000001','position',0,
      'content',jsonb_build_array(jsonb_build_object('language','es','title','Todo','description','')))),
    'sectors', jsonb_build_array(
      jsonb_build_object('id','1aa00000-0000-4000-8000-000000000002','position',0,'name','Cocina','kind','kitchen'),
      jsonb_build_object('id','1aa00000-0000-4000-8000-000000000003','position',1,'name','Barra','kind','bar'),
      jsonb_build_object('id','1aa00000-0000-4000-8000-000000000004','position',2,'name','Postres','kind','other')),
    'products', (
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'categoryId','1aa00000-0000-4000-8000-000000000001',
        'sectorId', p.sector, 'position', p.pos, 'priceCents', p.price, 'imageAssetId', null,
        'content', jsonb_build_array(jsonb_build_object('language','es','title',p.title,'description','')),
        'variants', '[]'::jsonb))
      from (values
        ('1ab00000-0000-4000-8000-000000000001','1aa00000-0000-4000-8000-000000000002',0,12500,'Milanesa'),
        ('1ab00000-0000-4000-8000-000000000002','1aa00000-0000-4000-8000-000000000003',1,4000,'Cerveza'),
        ('1ab00000-0000-4000-8000-000000000003','1aa00000-0000-4000-8000-000000000004',2,3000,'Flan')
      ) as p(id, sector, pos, price, title))),
  '1a100000-0000-4000-8000-000000000001');
select private.ensure_payment_methods((select t1 from scope), (select l1 from scope));

create function pg_temp.line(n integer, product text, quantity integer default 1) returns jsonb language sql as $$
  select jsonb_build_object('lineId', '1ac00000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'),
    'productId', product, 'variantId', null, 'quantity', quantity)
$$;
create function pg_temp.manual(command text, table_id text, items jsonb) returns jsonb language sql as $$
  select private.create_manual_order((select t1 from scope), (select l1 from scope),
    (select waiter from staff), command::uuid, table_id::uuid, 'table', null, null, items)
$$;
create function pg_temp.board(staff uuid) returns jsonb language sql as $$
  select private.production_board((select t1 from scope), (select l1 from scope), staff)
$$;
create function pg_temp.advance(staff uuid, command text, order_id uuid, line text, to_status text)
returns jsonb language sql as $$
  select private.advance_production_item((select t1 from scope), (select l1 from scope),
    staff, command::uuid, order_id, line::uuid, to_status)
$$;

-- Privileges ---------------------------------------------------------------
select ok(
  not has_table_privilege('authenticator', 'private.production_items', 'select')
    and not has_table_privilege('authenticator', 'private.production_items', 'update')
    and not has_table_privilege('authenticator', 'private.production_item_events', 'insert'),
  'the runtime role cannot touch the production tables directly');
select ok(
  has_function_privilege('authenticator', 'private.production_board(uuid,uuid,uuid)', 'execute')
    and has_function_privilege('authenticator', 'private.advance_production_item(uuid,uuid,uuid,uuid,uuid,uuid,text)', 'execute')
    and not has_function_privilege('authenticator', 'private.production_actor_kind(uuid,uuid,uuid)', 'execute'),
  'the runtime role executes the two entry points and no helper');

-- Routing ------------------------------------------------------------------
create temporary table order1 as select pg_temp.manual('1ad00000-0000-4000-8000-000000000001', '1a600000-0000-4000-8000-000000000001',
  jsonb_build_array(pg_temp.line(1, '1ab00000-0000-4000-8000-000000000001', 2), pg_temp.line(2, '1ab00000-0000-4000-8000-000000000002'), pg_temp.line(3, '1ab00000-0000-4000-8000-000000000003'))) result;
create temporary table o1 as select (result ->> 'orderId')::uuid id from order1;

select is((select count(*)::int from private.production_items), 3,
  'confirming an order creates one production row per item');
select results_eq(
  $$ select item.sector_kind, item.status from private.production_items item
     join private.confirmed_order_items line using (tenant_id, location_id, order_id, line_id)
     order by line.position $$,
  $$ values ('kitchen'::text, 'queued'::text), ('bar', 'queued'), ('other', 'queued') $$,
  'items are routed to the kind of their catalog sector and start queued');
select is((select count(*)::int from jsonb_array_elements(pg_temp.board((select kitchen from staff)) -> 'tickets')), 1,
  'the kitchen sees the order');
select results_eq(
  $$ select i ->> 'title' from jsonb_array_elements(pg_temp.board((select kitchen from staff)) -> 'tickets' -> 0 -> 'items') i $$,
  $$ values ('Milanesa'::text) $$,
  'the kitchen ticket holds only the kitchen items');
select results_eq(
  $$ select i ->> 'title' from jsonb_array_elements(pg_temp.board((select bar from staff)) -> 'tickets' -> 0 -> 'items') i $$,
  $$ values ('Cerveza'::text) $$,
  'the bar ticket holds only the bar items');
select is(pg_temp.board((select kitchen from staff)) ->> 'sector', 'kitchen', 'the board names its sector');
select is(pg_temp.board((select kitchen from staff)) -> 'tickets' -> 0 ->> 'tableLabel', '1', 'the ticket names the table');
select is(pg_temp.board((select kitchen from staff)) -> 'tickets' -> 0 ->> 'orderStatus', 'queued', 'a new order is queued');

-- Authorization ------------------------------------------------------------
select throws_ok($$ select pg_temp.board((select waiter from staff)) $$, 'PT200', null, 'a waiter cannot read a production board');
select throws_ok($$ select pg_temp.board((select manager from staff)) $$, 'PT200', null, 'a manager has no production board');
select throws_ok($$ select pg_temp.board('1a800000-0000-4000-8000-000000000001') $$, 'PT200', null, 'staff of another tenant cannot read this board');
update public.staff_members set is_active = false where id = (select kitchen2 from staff);
select throws_ok($$ select pg_temp.board((select kitchen2 from staff)) $$, 'PT200', null, 'an inactive cook cannot read the board');
update public.staff_members set is_active = true where id = (select kitchen2 from staff);

-- Unconfirmed intents never reach production -------------------------------
create function pg_temp.token(wanted_label text) returns text language sql as $$
  select qr.token from private.floor_table_qr_codes qr
  join private.floor_tables ft on ft.tenant_id = qr.tenant_id and ft.location_id = qr.location_id and ft.id = qr.table_id
  where ft.tenant_id = (select t1 from scope) and ft.label = wanted_label and qr.status = 'active'
$$;
create temporary table intent1 as select private.create_order_intent(
  (select t1 from scope), (select l1 from scope), pg_temp.token('2'),
  '1ae00000-0000-4000-8000-000000000001', 'table', 'Valentín', null, 'cash', 'in_person',
  jsonb_build_array(pg_temp.line(10, '1ab00000-0000-4000-8000-000000000001'))) result;
select is((select count(*)::int from private.production_items), 3, 'an intent awaiting the waiter creates no production row');
select is((select count(*)::int from jsonb_array_elements(pg_temp.board((select kitchen from staff)) -> 'tickets')), 1,
  'the kitchen never sees an unconfirmed intent');
select private.claim_waiter_call((select t1 from scope), (select l1 from scope), (select waiter from staff),
  (select (result ->> 'callId')::uuid from intent1), '1ae00000-0000-4000-8000-000000000002');
select private.decide_order_intent((select t1 from scope), (select l1 from scope), (select waiter from staff),
  (select (result ->> 'intentId')::uuid from intent1), '1ae00000-0000-4000-8000-000000000003', 'confirm', null);
select is((select count(*)::int from private.production_items), 4, 'confirming an intent distributes its items');
select is((select count(*)::int from jsonb_array_elements(pg_temp.board((select kitchen from staff)) -> 'tickets')), 2,
  'the confirmed intent appears on the kitchen board');
select is((select count(*)::int from jsonb_array_elements(pg_temp.board((select bar from staff)) -> 'tickets')), 1,
  'a kitchen-only order never appears on the bar board');

-- Retries do not duplicate -------------------------------------------------
select is(pg_temp.manual('1ad00000-0000-4000-8000-000000000001', '1a600000-0000-4000-8000-000000000001',
  jsonb_build_array(pg_temp.line(1, '1ab00000-0000-4000-8000-000000000001', 2), pg_temp.line(2, '1ab00000-0000-4000-8000-000000000002'), pg_temp.line(3, '1ab00000-0000-4000-8000-000000000003'))),
  (select result from order1), 'a repeated order command replays the stored result');
select is((select count(*)::int from private.production_items), 4, 'a repeated order command creates no extra production rows');

-- Advancing ----------------------------------------------------------------
create temporary table adv1 as select pg_temp.advance((select kitchen from staff), '1af00000-0000-4000-8000-000000000001',
  (select id from o1), '1ac00000-0000-4000-8000-000000000001', 'preparing') result;
select is((select result ->> 'status' from adv1), 'preparing', 'the kitchen starts preparing an item');
select is((select result ->> 'orderStatus' from adv1), 'in_preparation', 'the order derives in preparation');
select is((select result ->> 'changed' from adv1), 'true', 'the first command changes the item');
select is(pg_temp.advance((select kitchen from staff), '1af00000-0000-4000-8000-000000000001',
  (select id from o1), '1ac00000-0000-4000-8000-000000000001', 'preparing'),
  (select result from adv1), 'the same command replays its stored result');
select is((select count(*)::int from private.production_item_events), 1, 'a replayed command writes no second event');
select is((select (pg_temp.advance((select kitchen2 from staff), '1af00000-0000-4000-8000-000000000002',
  (select id from o1), '1ac00000-0000-4000-8000-000000000001', 'preparing') ->> 'changed')), 'false',
  'a second screen asking for the same state changes nothing');
select is((select count(*)::int from private.production_item_events), 1, 'a no-op writes no event');
select throws_ok($$ select pg_temp.advance((select kitchen from staff), '1af00000-0000-4000-8000-000000000001',
  (select id from o1), '1ac00000-0000-4000-8000-000000000001', 'ready') $$, 'PT100', null,
  'a command id cannot be reused for another transition');
select throws_ok($$ select pg_temp.advance((select kitchen from staff), '1af00000-0000-4000-8000-000000000003',
  (select id from o1), '1ac00000-0000-4000-8000-000000000001', 'queued') $$, 'PT220', null,
  'an item never goes back to the queue');
select throws_ok($$ select pg_temp.advance((select kitchen from staff), '1af00000-0000-4000-8000-000000000004',
  (select id from o1), '1ac00000-0000-4000-8000-000000000001', 'delivered') $$, 'PT212', null,
  'delivery belongs to a later step and is not a valid target');
select throws_ok($$ select pg_temp.advance((select bar from staff), '1af00000-0000-4000-8000-000000000005',
  (select id from o1), '1ac00000-0000-4000-8000-000000000001', 'preparing') $$, 'PT201', null,
  'the bar cannot move a kitchen item');
select throws_ok($$ select pg_temp.advance('1a800000-0000-4000-8000-000000000001', '1af00000-0000-4000-8000-000000000006',
  (select id from o1), '1ac00000-0000-4000-8000-000000000001', 'preparing') $$, 'PT200', null,
  'staff of another tenant cannot move this item');
select throws_ok($$ select pg_temp.advance((select waiter from staff), '1af00000-0000-4000-8000-000000000007',
  (select id from o1), '1ac00000-0000-4000-8000-000000000001', 'preparing') $$, 'PT200', null,
  'a waiter cannot move a production item');
select throws_ok($$ select pg_temp.advance((select kitchen from staff), '1af00000-0000-4000-8000-000000000008',
  (select id from o1), '1ac00000-0000-4000-8000-000000000002', 'preparing') $$, 'PT201', null,
  'the kitchen cannot move a bar item');
select throws_ok($$ select pg_temp.advance((select bar from staff), '1af00000-0000-4000-8000-000000000009',
  (select id from o1), '1ac00000-0000-4000-8000-000000000002', 'ready') $$, 'PT220', null,
  'an item cannot skip preparation');

select lives_ok($$ select pg_temp.advance((select kitchen from staff), '1af00000-0000-4000-8000-00000000000a',
  (select id from o1), '1ac00000-0000-4000-8000-000000000001', 'ready') $$, 'the kitchen finishes its item');
create function pg_temp.ticket(staff uuid) returns jsonb language sql as $$
  select t from jsonb_array_elements(pg_temp.board(staff) -> 'tickets') t
  where t ->> 'orderId' = (select id::text from o1)
$$;
select is(pg_temp.ticket((select kitchen from staff)) ->> 'status', 'ready',
  'the kitchen ticket is ready when its items are');
select is(pg_temp.ticket((select kitchen from staff)) ->> 'orderStatus', 'in_preparation',
  'the order is not ready while the bar item is queued');
select is((pg_temp.board((select kitchen from staff)) -> 'tickets' -> 1 ->> 'orderId')::uuid, (select id from o1),
  'completed tickets sort after the active ones');
select pg_temp.advance((select bar from staff), '1af00000-0000-4000-8000-00000000000b', (select id from o1), '1ac00000-0000-4000-8000-000000000002', 'preparing');
select is((select pg_temp.advance((select bar from staff), '1af00000-0000-4000-8000-00000000000c',
  (select id from o1), '1ac00000-0000-4000-8000-000000000002', 'ready') ->> 'orderStatus'), 'in_preparation',
  'the order stays in preparation while an item of another sector is queued');

-- History and immutability ---------------------------------------------------
select results_eq(
  $$ select from_status, to_status from private.production_item_events
     where line_id = '1ac00000-0000-4000-8000-000000000001' order by id $$,
  $$ values ('queued'::text, 'preparing'::text), ('preparing', 'ready') $$,
  'every transition keeps its history');
select throws_ok($$ update private.production_item_events set to_status = 'queued' $$, 'PT209', null, 'production history is append-only');
select throws_ok($$ delete from private.production_items $$, 'PT209', null, 'production rows are never deleted');
select throws_ok($$ update private.production_items set status = 'queued' where status = 'ready' $$, 'PT209', null,
  'a production row can only move forward one step');
select throws_ok($$ update private.confirmed_order_items set quantity = 3 $$, 'PT209', null, 'confirmed items stay append-only');
select is((select count(*)::int from private.audit_events where action = 'production.item_advanced'), 4,
  'every real transition is audited');

select * from finish();
rollback;
