begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(24);

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

create function pg_temp.split(staff uuid, command text, session uuid, parts integer) returns jsonb language sql as $$
  select private.create_account_split((select t1 from scope), (select l1 from scope), staff, command::uuid, session, parts)
$$;
create function pg_temp.pay_shares(staff uuid, command text, session uuid, split uuid, positions integer[], method text default 'cash', label text default null) returns jsonb language sql as $$
  select private.pay_split_shares((select t1 from scope), (select l1 from scope), staff, command::uuid, session, split, positions, method, 0, label)
$$;

select ok(
  not has_table_privilege('authenticator', 'private.account_splits', 'select')
    and has_function_privilege('authenticator', 'private.create_account_split(uuid,uuid,uuid,uuid,uuid,integer)', 'execute')
    and not has_function_privilege('authenticator', 'private.active_account_split(uuid,uuid,uuid)', 'execute'),
  'only the entry points are reachable');

select pg_temp.open_shift((select manager from staff), '2b900000-0000-4000-8000-000000000001', 0);
select pg_temp.manual('2b900000-0000-4000-8000-000000000002', '2b600000-0000-4000-8000-000000000001',
  jsonb_build_array(pg_temp.line(1, '2bb00000-0000-4000-8000-000000000001', 1), pg_temp.line(2, '2bb00000-0000-4000-8000-000000000002', 1)));
create temporary table s1 as select pg_temp.session_of('2b600000-0000-4000-8000-000000000001') id;
select throws_ok($$ select pg_temp.split((select ana from staff), '2b900000-0000-4000-8000-000000000003', (select id from s1), 1) $$, 'PT212', null, 'at least two parts');
select throws_ok($$ select pg_temp.split((select kitchen from staff), '2b900000-0000-4000-8000-000000000004', (select id from s1), 3) $$, 'PT200', null, 'kitchen cannot split');
create temporary table sp as select pg_temp.split((select ana from staff), '2b900000-0000-4000-8000-000000000005', (select id from s1), 3) r;
select is((select jsonb_path_query_array(r, '$.split.shares[*].amountCents') from sp), '[5500,5500,5500]'::jsonb, 'three equal shares of the pending balance');
select is(pg_temp.split((select ana from staff), '2b900000-0000-4000-8000-000000000005', (select id from s1), 3), (select r from sp), 'a retry returns the same split');
select is((select account -> 'split' ->> 'parts' from jsonb_array_elements(private.waiter_accounts_view((select t1 from scope), (select l1 from scope), (select ana from staff)) -> 'accounts') account limit 1), '3', 'the accounts view carries the split');

create temporary table sid as select (r -> 'split' ->> 'splitId')::uuid id from sp;
select throws_ok($$ select pg_temp.pay_shares((select ana from staff), '2b900000-0000-4000-8000-000000000006', (select id from s1), (select id from sid), array[4]) $$, 'PT260', null, 'a share that does not exist cannot be claimed');
select is((pg_temp.pay_shares((select ana from staff), '2b900000-0000-4000-8000-000000000007', (select id from s1), (select id from sid), array[1,2], 'cash', 'Ana') ->> 'amountCents')::int, 11000, 'one payer pays two shares as one payment');
select is((select count(*)::int from private.account_split_shares where split_id = (select id from sid) and status = 'paid' and payer_label = 'Ana'), 2, 'both shares are marked paid by the payer');
select throws_ok($$ select pg_temp.pay_shares((select ana from staff), '2b900000-0000-4000-8000-000000000008', (select id from s1), (select id from sid), array[2]) $$, 'PT260', null, 'a paid share cannot be claimed again');
select is(pg_temp.pay_shares((select ana from staff), '2b900000-0000-4000-8000-000000000007', (select id from s1), (select id from sid), array[1,2], 'cash', 'Ana') ->> 'amountCents', '11000', 'retrying the same command replays the result');
select is((select count(*)::int from private.account_entries where session_id = (select id from s1) and kind = 'payment'), 1, 'and records no second payment');
select throws_ok($$ select pg_temp.pay_shares((select ana from staff), '2b900000-0000-4000-8000-000000000009', (select id from s1), (select id from sid), array[3], 'bitcoin') $$, 'PT212', null, 'only in-person methods');
select is((select count(*)::int from private.account_split_shares where split_id = (select id from sid) and status = 'open'), 1, 'a failed payment leaves the share open');

select pg_temp.manual('2b900000-0000-4000-8000-000000000010', '2b600000-0000-4000-8000-000000000001', jsonb_build_array(pg_temp.line(3, '2bb00000-0000-4000-8000-000000000002', 1)));
select is((private.account_summary((select t1 from scope), (select l1 from scope), (select id from s1)) ->> 'pendingCents')::int, 9500, 'consumption after the split adds balance');
select is((pg_temp.pay_shares((select ana from staff), '2b900000-0000-4000-8000-000000000011', (select id from s1), (select id from sid), array[3]) ->> 'pendingCents')::int, 4000, 'the last share leaves only the new consumption');
select is((select status from private.account_splits where id = (select id from sid)), 'done', 'the split closes when every share is paid');
select throws_ok($$ select pg_temp.pay_shares((select ana from staff), '2b900000-0000-4000-8000-000000000012', (select id from s1), (select id from sid), array[3]) $$, 'PT260', null, 'a closed split takes no payments');

create temporary table sp2 as select pg_temp.split((select ana from staff), '2b900000-0000-4000-8000-000000000013', (select id from s1), 3) r;
select is((select jsonb_path_query_array(r, '$.split.shares[*].amountCents') from sp2), '[1334,1333,1333]'::jsonb, 'the remainder goes to the first shares');
create temporary table sid2 as select (r -> 'split' ->> 'splitId')::uuid id from sp2;
select pg_temp.split((select ana from staff), '2b900000-0000-4000-8000-000000000014', (select id from s1), 2);
select is((select status from private.account_splits where id = (select id from sid2)), 'superseded', 'a newer split supersedes it');
select throws_ok($$ select pg_temp.pay_shares((select ana from staff), '2b900000-0000-4000-8000-000000000015', (select id from s1), (select id from sid2), array[1]) $$, 'PT260', null, 'and its shares can no longer be claimed');
select throws_ok($$ update private.account_split_shares set status = 'open' where split_id = (select id from sid) $$, 'PT209', null, 'a paid share cannot be reopened');
select throws_ok($$ select pg_temp.split((select manager from staff), '2b900000-0000-4000-8000-000000000016', gen_random_uuid(), 2) $$, 'PT201', null, 'an unknown account is not found');
select is((select count(*)::int from private.audit_events where tenant_id = (select t1 from scope) and action = 'account.split_created'), 3, 'splits are audited');

select * from finish();
rollback;
