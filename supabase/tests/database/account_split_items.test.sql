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

create function pg_temp.split(staff uuid, command text, session uuid, parts integer) returns jsonb language sql as $$
  select private.create_account_split((select t1 from scope), (select l1 from scope), staff, command::uuid, session, parts)
$$;
create function pg_temp.token(wanted text) returns text language sql as $$
  select qr.token from private.floor_table_qr_codes qr
  join private.floor_tables ft on ft.tenant_id = qr.tenant_id and ft.location_id = qr.location_id and ft.id = qr.table_id
  where ft.tenant_id = (select t1 from scope) and ft.label = wanted and qr.status = 'active'
$$;
create function pg_temp.item_split(staff uuid, command text, session uuid, persons integer, assignments jsonb) returns jsonb language sql as $$
  select private.create_item_split((select t1 from scope), (select l1 from scope), staff, command::uuid, session, persons, assignments)
$$;
create function pg_temp.pay_shares(staff uuid, command text, session uuid, split uuid, positions integer[]) returns jsonb language sql as $$
  select private.pay_split_shares((select t1 from scope), (select l1 from scope), staff, command::uuid, session, split, positions, 'cash', 0, null)
$$;
create function pg_temp.dview(tok text, secret text) returns jsonb language sql as $$
  select private.diner_account_split_view((select t1 from scope), (select l1 from scope), tok, sha256(secret::bytea))
$$;
create function pg_temp.claim(tok text, pos integer, label text, secret text) returns jsonb language sql as $$
  select private.claim_split_share((select t1 from scope), (select l1 from scope), tok, pos, label, sha256(secret::bytea))
$$;
create function pg_temp.release(tok text, pos integer, secret text) returns jsonb language sql as $$
  select private.release_split_share((select t1 from scope), (select l1 from scope), tok, pos, sha256(secret::bytea))
$$;

select ok(
  has_function_privilege('authenticator', 'private.claim_split_share(uuid,uuid,text,integer,text,bytea)', 'execute')
    and not has_function_privilege('authenticator', 'private.diner_split_session(uuid,uuid,text)', 'execute')
    and not has_table_privilege('authenticator', 'private.account_split_assignments', 'insert'),
  'only the entry points are reachable');

select pg_temp.open_shift((select manager from staff), '2b900000-0000-4000-8000-000000000101', 0);
select pg_temp.manual('2b900000-0000-4000-8000-000000000102', '2b600000-0000-4000-8000-000000000001',
  jsonb_build_array(pg_temp.line(1, '2bb00000-0000-4000-8000-000000000001', 1),
    pg_temp.line(2, '2bb00000-0000-4000-8000-000000000002', 1),
    pg_temp.line(3, '2bb00000-0000-4000-8000-000000000002', 1)));
create temporary table s1 as select pg_temp.session_of('2b600000-0000-4000-8000-000000000001') id;
-- 20500 owed: 12500 + 4000 + 4000.
select is((select jsonb_array_length(account -> 'liveItems') from jsonb_array_elements(private.waiter_accounts_view((select t1 from scope), (select l1 from scope), (select ana from staff)) -> 'accounts') account limit 1), 3, 'the accounts view lists the live items');
select throws_ok($$ select pg_temp.item_split((select kitchen from staff), '2b900000-0000-4000-8000-000000000103', (select id from s1), 2, '[]') $$, 'PT200', null, 'kitchen cannot split');
select throws_ok($$ select pg_temp.item_split((select ana from staff), '2b900000-0000-4000-8000-000000000104', (select id from s1), 2,
  jsonb_build_array(jsonb_build_object('lineId', '2bc00000-0000-4000-8000-000000000099', 'position', 1))) $$, 'PT212', null, 'an item that is not on the account is refused');
select throws_ok($$ select pg_temp.item_split((select ana from staff), '2b900000-0000-4000-8000-000000000105', (select id from s1), 2,
  jsonb_build_array(jsonb_build_object('lineId', '2bc00000-0000-4000-8000-000000000001', 'position', 3))) $$, 'PT212', null, 'nor a person that does not exist');
select throws_ok($$ select pg_temp.item_split((select ana from staff), '2b900000-0000-4000-8000-000000000106', (select id from s1), 2,
  jsonb_build_array(jsonb_build_object('lineId', '2bc00000-0000-4000-8000-000000000001', 'position', 1),
    jsonb_build_object('lineId', '2bc00000-0000-4000-8000-000000000001', 'position', 2))) $$, 'PT212', null, 'nor an item given to two people');
select throws_ok($$ select pg_temp.item_split((select ana from staff), '2b900000-0000-4000-8000-000000000107', (select id from s1), 3,
  jsonb_build_array(jsonb_build_object('lineId', '2bc00000-0000-4000-8000-000000000001', 'position', 1),
    jsonb_build_object('lineId', '2bc00000-0000-4000-8000-000000000002', 'position', 2),
    jsonb_build_object('lineId', '2bc00000-0000-4000-8000-000000000003', 'position', 2))) $$, 'PT212', null, 'a person who would owe nothing is refused');

create temporary table sp as select pg_temp.item_split((select ana from staff), '2b900000-0000-4000-8000-000000000108', (select id from s1), 2,
  jsonb_build_array(jsonb_build_object('lineId', '2bc00000-0000-4000-8000-000000000001', 'position', 1),
    jsonb_build_object('lineId', '2bc00000-0000-4000-8000-000000000002', 'position', 2))) r;
select is((select jsonb_path_query_array(r, '$.split.shares[*].amountCents') from sp), '[14500,6000]'::jsonb, 'each pays what they own plus half of what is shared');
select is((select r -> 'split' -> 'shares' -> 0 -> 'items' from sp), '["1 × Milanesa"]'::jsonb, 'a share lists its items');
select is((select jsonb_array_length(r -> 'split' -> 'sharedItems') from sp), 1, 'and the split lists what is shared');
select is(pg_temp.item_split((select ana from staff), '2b900000-0000-4000-8000-000000000108', (select id from s1), 2,
  jsonb_build_array(jsonb_build_object('lineId', '2bc00000-0000-4000-8000-000000000001', 'position', 1),
    jsonb_build_object('lineId', '2bc00000-0000-4000-8000-000000000002', 'position', 2))), (select r from sp), 'a retry replays it');
select throws_ok($$ update private.account_split_assignments set position = 2 $$, 'PT209', null, 'assignments are immutable');

create temporary table sid as select (r -> 'split' ->> 'splitId')::uuid id from sp;
select is((pg_temp.dview(pg_temp.token('1'), 'device-a') -> 'split' ->> 'kind'), 'items', 'the diner sees the split of the table');
select is((pg_temp.claim(pg_temp.token('1'), 2, ' Beto ', 'device-a') -> 'split' -> 'shares' -> 1 ->> 'mine')::boolean, true, 'a diner claims a share and it is theirs');
select throws_ok($$ select pg_temp.claim(pg_temp.token('1'), 2, 'Ana', 'device-b') $$, 'PT260', null, 'nobody else can claim it');
select is((pg_temp.dview(pg_temp.token('1'), 'device-b') -> 'split' -> 'shares' -> 1 ->> 'claimedBy'), 'Beto', 'others see who holds it');
select is((pg_temp.dview(pg_temp.token('1'), 'device-b') -> 'split' -> 'shares' -> 1 ->> 'mine')::boolean, false, 'but not as theirs');
select throws_ok($$ select pg_temp.release(pg_temp.token('1'), 2, 'device-b') $$, 'PT260', null, 'nor release it');
select throws_ok($$ select pg_temp.claim(pg_temp.token('1'), 1, ' ', 'device-a') $$, 'PT212', null, 'a claim needs a name');
select throws_ok($$ select pg_temp.claim(pg_temp.token('2'), 1, 'Ana', 'device-a') $$, 'PT201', null, 'a table without an open account has nothing to claim');
select throws_ok($$ select private.claim_split_share((select t1 from scope), (select l1 from scope), repeat('0', 64), 1, 'Ana', sha256('x'::bytea)) $$, 'PT201', null, 'an invented token claims nothing');
select is((pg_temp.release(pg_temp.token('1'), 2, 'device-a') -> 'split' -> 'shares' -> 1 ->> 'status'), 'open', 'its holder releases it');
select pg_temp.claim(pg_temp.token('1'), 2, 'Beto', 'device-a');
select pg_temp.claim(pg_temp.token('1'), 1, 'Beto', 'device-a');
select is((pg_temp.pay_shares((select ana from staff), '2b900000-0000-4000-8000-000000000109', (select id from s1), (select id from sid), array[2]) ->> 'amountCents')::int, 6000, 'the waiter collects a claimed share');
select is((select payer_label from private.account_split_shares where split_id = (select id from sid) and position = 2), 'Beto', 'and it keeps who paid it');
select throws_ok($$ select pg_temp.release(pg_temp.token('1'), 2, 'device-a') $$, 'PT260', null, 'a paid share cannot be released');

select pg_temp.split((select ana from staff), '2b900000-0000-4000-8000-000000000110', (select id from s1), 2);
select is((select status from private.account_split_shares where split_id = (select id from sid) and position = 1), 'cancelled', 'a new split voids a claimed share');
select is((select count(*)::int from private.audit_events where tenant_id = (select t1 from scope) and action = 'account.item_split_created'), 1, 'the item split is audited');

select * from finish();
rollback;
