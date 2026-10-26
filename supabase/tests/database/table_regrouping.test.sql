begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(85);

insert into auth.users (id) values ('2e100000-0000-4000-8000-000000000001'), ('2e100000-0000-4000-8000-000000000002');
insert into public.tenants (id, slug, name, status) values
  ('2e200000-0000-4000-8000-000000000001', 'regroup-one', 'Regroup One', 'active'),
  ('2e200000-0000-4000-8000-000000000002', 'regroup-two', 'Regroup Two', 'active');
insert into public.tenant_memberships (tenant_id, user_id, role)
values ('2e200000-0000-4000-8000-000000000001', '2e100000-0000-4000-8000-000000000001', 'admin'),
  ('2e200000-0000-4000-8000-000000000002', '2e100000-0000-4000-8000-000000000002', 'admin');

create temporary table scope as select
  '2e200000-0000-4000-8000-000000000001'::uuid t1,
  (select id from public.locations where tenant_id = '2e200000-0000-4000-8000-000000000001') l1,
  '2e200000-0000-4000-8000-000000000002'::uuid t2,
  (select id from public.locations where tenant_id = '2e200000-0000-4000-8000-000000000002') l2;

-- Five tables: 1, 2, 3 in the hall (Ana), 4 on the patio (Luis), 5 on the terrace floor.
create function pg_temp.plan(groups jsonb) returns jsonb language sql as $$
  select jsonb_build_object(
    'floors', jsonb_build_array(
      jsonb_build_object('id','2e400000-0000-4000-8000-000000000001','name','Planta baja','position',0,'shortName',null),
      jsonb_build_object('id','2e400000-0000-4000-8000-000000000002','name','Terraza','position',1,'shortName',null)),
    'sectors', jsonb_build_array(
      jsonb_build_object('id','2e500000-0000-4000-8000-000000000001','name','Salón','position',0),
      jsonb_build_object('id','2e500000-0000-4000-8000-000000000002','name','Patio','position',1)),
    'tables', (
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'label', t.label, 'sectorId', t.sector, 'floorId', t.floor,
        'shape','square','x', t.x,'y',40,'width',100,'height',100,'rotation',0,'seatCount',4,
        'seatLayout','perimeter'))
      from (values
        ('2e600000-0000-4000-8000-000000000001','1','2e500000-0000-4000-8000-000000000001','2e400000-0000-4000-8000-000000000001',40),
        ('2e600000-0000-4000-8000-000000000002','2','2e500000-0000-4000-8000-000000000001','2e400000-0000-4000-8000-000000000001',200),
        ('2e600000-0000-4000-8000-000000000003','3','2e500000-0000-4000-8000-000000000001','2e400000-0000-4000-8000-000000000001',360),
        ('2e600000-0000-4000-8000-000000000004','4','2e500000-0000-4000-8000-000000000002','2e400000-0000-4000-8000-000000000001',520),
        ('2e600000-0000-4000-8000-000000000005','5','2e500000-0000-4000-8000-000000000001','2e400000-0000-4000-8000-000000000002',680)
      ) as t(id, label, sector, floor, x)),
    'groups', groups
  )
$$;
select private.save_floor_plan(
  (select t1 from scope), (select l1 from scope),
  '2e100000-0000-4000-8000-000000000001',
  '2e300000-0000-4000-8000-000000000001', 0, pg_temp.plan('[]'::jsonb));

create function pg_temp.member(username text, role text, sectors uuid[] default '{}')
returns uuid language sql as $$
  select (private.create_staff_member(
    (select t1 from scope), (select l1 from scope),
    '2e100000-0000-4000-8000-000000000001',
    username, initcap(username), role, 'scrypt-v1$c2FsdA$aGFzaA', sectors) ->> 'id')::uuid
$$;
create temporary table staff as select
  pg_temp.member('ana', 'waiter', array['2e500000-0000-4000-8000-000000000001'::uuid]) ana,
  pg_temp.member('luis', 'waiter', array['2e500000-0000-4000-8000-000000000002'::uuid]) luis,
  pg_temp.member('marta', 'manager') manager,
  pg_temp.member('coco', 'kitchen') kitchen;
insert into public.staff_members (id, tenant_id, location_id, username, display_name, role, created_by)
values ('2e800000-0000-4000-8000-000000000001', (select t2 from scope), (select l2 from scope),
  'otra', 'Otra', 'manager', '2e100000-0000-4000-8000-000000000001');

insert into private.location_publications (tenant_id, location_id, published_by)
values ((select t1 from scope), (select l1 from scope), '2e100000-0000-4000-8000-000000000001');
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
  '2e100000-0000-4000-8000-000000000001');
select private.ensure_payment_methods((select t1 from scope), (select l1 from scope));

create function pg_temp.line(n integer, product text, quantity integer default 1) returns jsonb language sql as $$
  select jsonb_build_object('lineId', '2ec00000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'),
    'productId', product, 'variantId', null, 'quantity', quantity)
$$;
-- A manual order of 16500 (milanesa + cerveza) on a table.
create function pg_temp.order_on(command text, wanted text, first_line integer) returns jsonb language sql as $$
  select private.create_manual_order((select t1 from scope), (select l1 from scope),
    (select manager from staff), command::uuid, wanted::uuid, 'table', null, null,
    jsonb_build_array(
      pg_temp.line(first_line, '2eb00000-0000-4000-8000-000000000001', 1),
      pg_temp.line(first_line + 1, '2eb00000-0000-4000-8000-000000000002', 1)))
$$;
create function pg_temp.session_of(wanted text) returns uuid language sql as $$
  select s.id from private.table_sessions s where s.status = 'open' and s.scope_key = wanted::uuid
$$;
create function pg_temp.pay(staff uuid, command text, session uuid, method text, amount integer default null) returns jsonb language sql as $$
  select private.record_account_payment((select t1 from scope), (select l1 from scope), staff, command::uuid, session, method, amount, 0)
$$;
create function pg_temp.close_session(staff uuid, command text, session uuid) returns jsonb language sql as $$
  select private.close_table_session((select t1 from scope), (select l1 from scope), staff, command::uuid, session)
$$;
create function pg_temp.clean(command text, wanted text) returns jsonb language sql as $$
  select private.mark_table_clean((select t1 from scope), (select l1 from scope), (select manager from staff), command::uuid, wanted::uuid)
$$;
create function pg_temp.join_tables(staff uuid, command text, tables text[], name text default null) returns jsonb language sql as $$
  select private.join_tables((select t1 from scope), (select l1 from scope), staff, command::uuid,
    (select array_agg(t::uuid) from unnest(tables) t), name)
$$;
create function pg_temp.separate(staff uuid, command text, wanted text, anchor text default null) returns jsonb language sql as $$
  select private.separate_tables((select t1 from scope), (select l1 from scope), staff, command::uuid,
    wanted::uuid, anchor::uuid)
$$;
create function pg_temp.state_of(wanted text) returns text language sql as $$
  select private.waiter_table_state((select t1 from scope), (select l1 from scope), wanted::uuid)
$$;
create function pg_temp.token_of(wanted text) returns text language sql as $$
  select qr.token from private.floor_table_qr_codes qr where qr.table_id = wanted::uuid and qr.status = 'active'
$$;
create function pg_temp.qr_session(wanted text) returns uuid language sql as $$
  select private.diner_split_session((select t1 from scope), (select l1 from scope), pg_temp.token_of(wanted))
$$;
create function pg_temp.entry_group(wanted text) returns text language sql as $$
  select entry.group_id::text from private.resolve_table_entry((select t1 from scope), (select l1 from scope), pg_temp.token_of(wanted)) entry
$$;
create function pg_temp.entry_state(wanted text) returns text language sql as $$
  select entry.service_state from private.resolve_table_entry((select t1 from scope), (select l1 from scope), pg_temp.token_of(wanted)) entry
$$;
create function pg_temp.members_of(wanted text) returns text[] language sql as $$
  select coalesce(array_agg(member.table_id::text order by member.table_id), '{}')
  from private.floor_group_members member where member.group_id = wanted::uuid
$$;
create function pg_temp.ledger() returns text language sql as $$
  select count(*)::text || ':' || coalesce(sum(amount_cents), 0)::text from private.account_entries
$$;
create function pg_temp.orders() returns text language sql as $$
  select coalesce(string_agg(o.id::text || o.table_id::text || o.session_id::text, ',' order by o.id), '') from private.confirmed_orders o
$$;

-- 1. Only the entry points are reachable; the history is closed to the runtime.
select ok(
  not has_table_privilege('authenticator', 'private.table_group_events', 'select')
    and has_function_privilege('authenticator', 'private.join_tables(uuid,uuid,uuid,uuid,uuid[],text)', 'execute')
    and has_function_privilege('authenticator', 'private.separate_tables(uuid,uuid,uuid,uuid,uuid,uuid)', 'execute'),
  'only the entry points are reachable');

select private.open_cash_shift((select t1 from scope), (select l1 from scope), (select manager from staff),
  '2ed00000-0000-4000-8000-000000000001', 0);

-- 2-9. Joining loose tables without an account.
select throws_ok($$ select pg_temp.join_tables((select ana from staff), '2ed00000-0000-4000-8000-000000000010', array['2e600000-0000-4000-8000-000000000001']) $$,
  'PT277', null, 'one table is not a group');
select throws_ok($$ select pg_temp.join_tables((select ana from staff), '2ed00000-0000-4000-8000-000000000011', array['2e600000-0000-4000-8000-000000000001','2e600000-0000-4000-8000-000000000001']) $$,
  'PT277', null, 'the same table twice is not a group');
select throws_ok($$ select pg_temp.join_tables((select ana from staff), '2ed00000-0000-4000-8000-000000000012', array['2e600000-0000-4000-8000-000000000001','2e600000-0000-4000-8000-000000000005']) $$,
  'PT277', null, 'tables of two floors cannot be joined');
select throws_ok($$ select pg_temp.join_tables((select kitchen from staff), '2ed00000-0000-4000-8000-000000000013', array['2e600000-0000-4000-8000-000000000001','2e600000-0000-4000-8000-000000000002']) $$,
  'PT200', null, 'kitchen cannot join tables');
select throws_ok($$ select pg_temp.join_tables((select luis from staff), '2ed00000-0000-4000-8000-000000000014', array['2e600000-0000-4000-8000-000000000001','2e600000-0000-4000-8000-000000000004']) $$,
  'PT201', null, 'a waiter must serve every table to join them');
select throws_ok($$ select private.join_tables((select t1 from scope), (select l1 from scope),
  '2e800000-0000-4000-8000-000000000001', '2ed00000-0000-4000-8000-000000000015',
  array['2e600000-0000-4000-8000-000000000001','2e600000-0000-4000-8000-000000000002']::uuid[], null) $$,
  'PT200', null, 'staff of another business cannot join tables');
select is((select count(*)::int from private.floor_groups where tenant_id = (select t1 from scope)), 0, 'a refused join leaves no group');

create temporary table joined1 as select pg_temp.join_tables((select ana from staff), '2ed00000-0000-4000-8000-000000000016',
  array['2e600000-0000-4000-8000-000000000001','2e600000-0000-4000-8000-000000000002'], 'Cumple') r;
select is((select r ->> 'name' from joined1), 'Cumple', 'the group takes the given name');
select is(pg_temp.members_of((select r ->> 'groupId' from joined1)), array['2e600000-0000-4000-8000-000000000001','2e600000-0000-4000-8000-000000000002'], 'the group holds both tables');
select is((select r ->> 'sessionId' from joined1), null, 'no account is opened by joining');
select is(pg_temp.join_tables((select ana from staff), '2ed00000-0000-4000-8000-000000000016',
  array['2e600000-0000-4000-8000-000000000001','2e600000-0000-4000-8000-000000000002'], 'Cumple'), (select r from joined1), 'a retried command returns the stored result');
select is((select count(*)::int from private.floor_groups where tenant_id = (select t1 from scope)), 1, 'a retry creates no second group');
select is(pg_temp.entry_group('2e600000-0000-4000-8000-000000000002'), (select r ->> 'groupId' from joined1), 'the QR of the second table recognises the group');
select is((select version from private.floor_plans where tenant_id = (select t1 from scope)), 2, 'joining bumps the plan version so a stale editor cannot overwrite it');

-- 10-17. The group opens ONE account; a table joined later shares it.
select pg_temp.order_on('2ed00000-0000-4000-8000-000000000020', '2e600000-0000-4000-8000-000000000001', 1);
create temporary table s1 as select pg_temp.session_of((select r ->> 'groupId' from joined1)) id;
select ok((select id is not null from s1), 'the order opened one account for the group');
select is(pg_temp.state_of('2e600000-0000-4000-8000-000000000002'), 'occupied', 'the other table of the group shows occupied');
select pg_temp.pay((select ana from staff), '2ed00000-0000-4000-8000-000000000021', (select id from s1), 'cash', 10000);
create temporary table before_join as select pg_temp.ledger() ledger, pg_temp.orders() orders,
  (private.account_summary((select t1 from scope), (select l1 from scope), (select id from s1))) summary;

create temporary table joined2 as select pg_temp.join_tables((select ana from staff), '2ed00000-0000-4000-8000-000000000022',
  array['2e600000-0000-4000-8000-000000000003','2e600000-0000-4000-8000-000000000001']) r;
select is((select r ->> 'groupId' from joined2), (select r ->> 'groupId' from joined1), 'joining a member keeps the existing group');
select is((select r ->> 'name' from joined2), 'Cumple', 'the group keeps its name');
select is(jsonb_array_length((select r -> 'tables' from joined2)), 3, 'the group now has three tables');
select is((select r ->> 'sessionId' from joined2), (select id::text from s1), 'the open account follows the group');
select is(pg_temp.state_of('2e600000-0000-4000-8000-000000000003'), 'occupied', 'the table that joined an open account is occupied');
select is(pg_temp.qr_session('2e600000-0000-4000-8000-000000000003'), (select id from s1), 'the QR of the new table reaches the same account');
select is((select scope_key::text from private.table_sessions where id = (select id from s1)), (select r ->> 'groupId' from joined1), 'the account is scoped to the group');
select is(pg_temp.ledger() || pg_temp.orders(), (select ledger || orders from before_join), 'joining moves no order, payment or debt');
select is(private.account_summary((select t1 from scope), (select l1 from scope), (select id from s1)), (select summary from before_join), 'the balance is the same after joining');

-- 18-21. Two different open accounts are never mixed.
select pg_temp.order_on('2ed00000-0000-4000-8000-000000000023', '2e600000-0000-4000-8000-000000000004', 3);
create temporary table s4 as select pg_temp.session_of('2e600000-0000-4000-8000-000000000004') id;
select throws_ok($$ select pg_temp.join_tables((select manager from staff), '2ed00000-0000-4000-8000-000000000024',
  array['2e600000-0000-4000-8000-000000000004','2e600000-0000-4000-8000-000000000001']) $$,
  'PT278', null, 'two open accounts cannot be merged');
select is(pg_temp.members_of((select r ->> 'groupId' from joined1)), array['2e600000-0000-4000-8000-000000000001','2e600000-0000-4000-8000-000000000002','2e600000-0000-4000-8000-000000000003'], 'the refused join changed no group');
select is((select group_id from private.table_sessions where id = (select id from s4)), null, 'the loose account keeps its own scope');
select is((select status from private.table_sessions where id = (select id from s1)), 'open', 'the group account is untouched');

-- 22-23. A table pending cleaning or out of service cannot be brought in.
insert into private.floor_table_service_states (tenant_id, location_id, table_id, state)
values ((select t1 from scope), (select l1 from scope), '2e600000-0000-4000-8000-000000000005', 'out_of_service');
select throws_ok($$ select pg_temp.join_tables((select manager from staff), '2ed00000-0000-4000-8000-000000000025',
  array['2e600000-0000-4000-8000-000000000005','2e600000-0000-4000-8000-000000000004']) $$,
  'PT277', null, 'a table out of service cannot be joined');
delete from private.floor_table_service_states where table_id = '2e600000-0000-4000-8000-000000000005';

-- 24-27. The floor plan editor cannot rewrite groups that have an open account.
select throws_ok($$ select private.save_floor_plan((select t1 from scope), (select l1 from scope),
  '2e100000-0000-4000-8000-000000000001', '2e300000-0000-4000-8000-000000000002',
  (select version from private.floor_plans where tenant_id = (select t1 from scope)),
  pg_temp.plan('[]'::jsonb)) $$,
  'PT280', null, 'the editor cannot dissolve a group with an open account');
select throws_ok($$ select private.save_floor_plan((select t1 from scope), (select l1 from scope),
  '2e100000-0000-4000-8000-000000000001', '2e300000-0000-4000-8000-000000000003',
  (select version from private.floor_plans where tenant_id = (select t1 from scope)),
  pg_temp.plan(jsonb_build_array(jsonb_build_object('id', (select r ->> 'groupId' from joined1), 'name', 'Cumple',
    'tableIds', jsonb_build_array('2e600000-0000-4000-8000-000000000001','2e600000-0000-4000-8000-000000000004'))))) $$,
  'PT280', null, 'the editor cannot move a table with an open account into another account''s group');
select is(pg_temp.members_of((select r ->> 'groupId' from joined1)), array['2e600000-0000-4000-8000-000000000001','2e600000-0000-4000-8000-000000000002','2e600000-0000-4000-8000-000000000003'], 'the refused saves changed nothing');
select lives_ok($$ select private.save_floor_plan((select t1 from scope), (select l1 from scope),
  '2e100000-0000-4000-8000-000000000001', '2e300000-0000-4000-8000-000000000004',
  (select version from private.floor_plans where tenant_id = (select t1 from scope)),
  pg_temp.plan(jsonb_build_array(jsonb_build_object('id', (select r ->> 'groupId' from joined1), 'name', 'Cumple 2',
    'tableIds', jsonb_build_array('2e600000-0000-4000-8000-000000000001','2e600000-0000-4000-8000-000000000002','2e600000-0000-4000-8000-000000000003'))))) $$,
  'the editor may rename a group that keeps its tables');

-- 28-40. Separating: the account stays with the anchor, nothing else moves.
create temporary table before_sep as select pg_temp.ledger() ledger, pg_temp.orders() orders,
  (private.account_summary((select t1 from scope), (select l1 from scope), (select id from s1))) summary;
select throws_ok($$ select pg_temp.separate((select ana from staff), '2ed00000-0000-4000-8000-000000000030', (select r ->> 'groupId' from joined1)) $$,
  'PT279', null, 'an open account needs an anchor table');
select throws_ok($$ select pg_temp.separate((select ana from staff), '2ed00000-0000-4000-8000-000000000031', (select r ->> 'groupId' from joined1), '2e600000-0000-4000-8000-000000000004') $$,
  'PT279', null, 'the anchor must belong to the group');
select throws_ok($$ select pg_temp.separate((select luis from staff), '2ed00000-0000-4000-8000-000000000032', (select r ->> 'groupId' from joined1), '2e600000-0000-4000-8000-000000000002') $$,
  'PT201', null, 'a waiter who does not serve the tables cannot separate them');
select throws_ok($$ select pg_temp.separate((select kitchen from staff), '2ed00000-0000-4000-8000-000000000033', (select r ->> 'groupId' from joined1), '2e600000-0000-4000-8000-000000000002') $$,
  'PT200', null, 'kitchen cannot separate tables');
select throws_ok($$ select pg_temp.separate((select ana from staff), '2ed00000-0000-4000-8000-000000000034', '2e700000-0000-4000-8000-0000000000ff', null) $$,
  'PT201', null, 'an unknown group is not found');

create temporary table sep1 as select pg_temp.separate((select ana from staff), '2ed00000-0000-4000-8000-000000000035',
  (select r ->> 'groupId' from joined1), '2e600000-0000-4000-8000-000000000002') r;
select is((select r ->> 'sessionId' from sep1), (select id::text from s1), 'the same account continues');
select is((select r ->> 'anchorTableId' from sep1), '2e600000-0000-4000-8000-000000000002', 'the result names the anchor');
select is((select scope_key::text from private.table_sessions where id = (select id from s1)), '2e600000-0000-4000-8000-000000000002', 'the account is scoped to the anchor table');
select is((select table_id::text || coalesce(group_id::text, '-') from private.table_sessions where id = (select id from s1)), '2e600000-0000-4000-8000-000000000002-', 'the account has no group any more');
select is((select count(*)::int from private.floor_groups where id = (select r ->> 'groupId' from joined1)::uuid), 0, 'the group is gone');
select is(pg_temp.state_of('2e600000-0000-4000-8000-000000000002'), 'occupied', 'the anchor stays occupied');
select is(pg_temp.state_of('2e600000-0000-4000-8000-000000000001'), 'available', 'a released table that was only occupied becomes available');
select is(pg_temp.state_of('2e600000-0000-4000-8000-000000000003'), 'available', 'every other table is released too');
select is((select r -> 'releasedTableIds' from sep1), '["2e600000-0000-4000-8000-000000000001","2e600000-0000-4000-8000-000000000003"]'::jsonb, 'the result lists the released tables');
select is(pg_temp.ledger() || pg_temp.orders(), (select ledger || orders from before_sep), 'separating moves no order, payment or debt');
select is(private.account_summary((select t1 from scope), (select l1 from scope), (select id from s1)), (select summary from before_sep), 'the balance is the same after separating');
select is(pg_temp.qr_session('2e600000-0000-4000-8000-000000000002'), (select id from s1), 'the anchor QR reaches the account');
select is(pg_temp.qr_session('2e600000-0000-4000-8000-000000000001'), null, 'a released table QR no longer reaches it');
select is(pg_temp.entry_group('2e600000-0000-4000-8000-000000000001'), null, 'the QR of a released table shows no group');
select is(pg_temp.entry_state('2e600000-0000-4000-8000-000000000001'), 'available', 'and it is available');

-- 41-47. The old order keeps its origin table; new orders on a released table open a new account.
select is((select table_id::text from private.confirmed_orders where session_id = (select id from s1) limit 1), '2e600000-0000-4000-8000-000000000001', 'the order keeps the table it came from');
select pg_temp.order_on('2ed00000-0000-4000-8000-000000000036', '2e600000-0000-4000-8000-000000000001', 5);
create temporary table s1b as select pg_temp.session_of('2e600000-0000-4000-8000-000000000001') id;
select ok((select id is not null and id <> (select id from s1) from s1b), 'a released table starts a different account');
select pg_temp.pay((select ana from staff), '2ed00000-0000-4000-8000-000000000037', (select id from s1b), 'cash');
select pg_temp.close_session((select ana from staff), '2ed00000-0000-4000-8000-000000000038', (select id from s1b));
select is(pg_temp.state_of('2e600000-0000-4000-8000-000000000001'), 'needs_cleaning', 'closing the new account leaves that table pending cleaning');
select pg_temp.pay((select ana from staff), '2ed00000-0000-4000-8000-000000000039', (select id from s1), 'debit_card');
select pg_temp.close_session((select ana from staff), '2ed00000-0000-4000-8000-00000000003a', (select id from s1));
select is(pg_temp.state_of('2e600000-0000-4000-8000-000000000002'), 'needs_cleaning', 'closing the original account cleans only its table');
select is(pg_temp.state_of('2e600000-0000-4000-8000-000000000003'), 'available', 'the table that was released is untouched by the close');

-- 48-50. Tables pending cleaning cannot be grouped until they are clean.
select throws_ok($$ select pg_temp.join_tables((select ana from staff), '2ed00000-0000-4000-8000-000000000040',
  array['2e600000-0000-4000-8000-000000000002','2e600000-0000-4000-8000-000000000003']) $$,
  'PT277', null, 'a table pending cleaning cannot be joined');
select pg_temp.clean('2ed00000-0000-4000-8000-000000000041', '2e600000-0000-4000-8000-000000000001');
select pg_temp.clean('2ed00000-0000-4000-8000-000000000042', '2e600000-0000-4000-8000-000000000002');
select is(pg_temp.state_of('2e600000-0000-4000-8000-000000000002'), 'available', 'a cleaned table is available again');

-- 51-58. Releasing according to state: a table out of service stays out of service.
create temporary table joined3 as select pg_temp.join_tables((select ana from staff), '2ed00000-0000-4000-8000-000000000043',
  array['2e600000-0000-4000-8000-000000000001','2e600000-0000-4000-8000-000000000003']) r;
select pg_temp.order_on('2ed00000-0000-4000-8000-000000000044', '2e600000-0000-4000-8000-000000000003', 7);
create temporary table s3 as select pg_temp.session_of((select r ->> 'groupId' from joined3)) id;
insert into private.floor_table_service_states (tenant_id, location_id, table_id, state)
values ((select t1 from scope), (select l1 from scope), '2e600000-0000-4000-8000-000000000001', 'out_of_service');
create temporary table sep3 as select pg_temp.separate((select ana from staff), '2ed00000-0000-4000-8000-000000000045',
  (select r ->> 'groupId' from joined3), '2e600000-0000-4000-8000-000000000003') r;
select is(pg_temp.state_of('2e600000-0000-4000-8000-000000000001'), 'out_of_service', 'a table out of service is not released');
select is(pg_temp.state_of('2e600000-0000-4000-8000-000000000003'), 'occupied', 'the anchor keeps the account');
select is((select r -> 'releasedTableIds' from sep3), '[]'::jsonb, 'nothing was released');
select is((select scope_key::text from private.table_sessions where id = (select id from s3)), '2e600000-0000-4000-8000-000000000003', 'the account moved to the anchor');
select pg_temp.pay((select ana from staff), '2ed00000-0000-4000-8000-000000000046', (select id from s3), 'cash');
select pg_temp.close_session((select ana from staff), '2ed00000-0000-4000-8000-000000000047', (select id from s3));
delete from private.floor_table_service_states where table_id = '2e600000-0000-4000-8000-000000000001';
select pg_temp.clean('2ed00000-0000-4000-8000-000000000048', '2e600000-0000-4000-8000-000000000003');

-- 59-66. Separating a group whose account is closed needs no anchor and keeps the states.
create temporary table joined4 as select pg_temp.join_tables((select manager from staff), '2ed00000-0000-4000-8000-000000000050',
  array['2e600000-0000-4000-8000-000000000003','2e600000-0000-4000-8000-000000000004'], 'Patio y salón') r;
select pg_temp.pay((select manager from staff), '2ed00000-0000-4000-8000-000000000051', (select id from s4), 'cash');
select pg_temp.close_session((select manager from staff), '2ed00000-0000-4000-8000-000000000052', (select id from s4));
select is(pg_temp.state_of('2e600000-0000-4000-8000-000000000004'), 'needs_cleaning', 'the loose account closed');
select pg_temp.clean('2ed00000-0000-4000-8000-000000000053', '2e600000-0000-4000-8000-000000000004');
select pg_temp.order_on('2ed00000-0000-4000-8000-000000000054', '2e600000-0000-4000-8000-000000000004', 9);
create temporary table s5 as select pg_temp.session_of((select r ->> 'groupId' from joined4)) id;
select ok((select id is not null from s5), 'the group has an account again');
select pg_temp.pay((select manager from staff), '2ed00000-0000-4000-8000-000000000055', (select id from s5), 'cash');
select pg_temp.close_session((select manager from staff), '2ed00000-0000-4000-8000-000000000056', (select id from s5));
select is(pg_temp.state_of('2e600000-0000-4000-8000-000000000003'), 'needs_cleaning', 'closing the group leaves every table pending cleaning');
create temporary table closed5 as select to_jsonb(s) row from private.table_sessions s where s.id = (select id from s5);
create temporary table sep4 as select pg_temp.separate((select manager from staff), '2ed00000-0000-4000-8000-000000000057', (select r ->> 'groupId' from joined4)) r;
select is((select r ->> 'anchorTableId' from sep4), null, 'no anchor is needed when the account is closed');
select is(pg_temp.state_of('2e600000-0000-4000-8000-000000000003') || pg_temp.state_of('2e600000-0000-4000-8000-000000000004'), 'needs_cleaningneeds_cleaning', 'the tables stay pending cleaning');
select is((select to_jsonb(s) from private.table_sessions s where s.id = (select id from s5)), (select row from closed5), 'the closed account keeps its history untouched');
select is((select count(*)::int from private.table_group_events where tenant_id = (select t1 from scope)), 7, 'every join and separation is recorded');

-- 67-72. The history and the audit trail.
select is((select count(*)::int from private.table_group_events where tenant_id = (select t1 from scope) and kind = 'separated' and session_id is not null), 2, 'separations with an open account name the account');
select throws_ok($$ update private.table_group_events set kind = 'joined' where tenant_id = (select t1 from scope) $$,
  null, null, 'the history cannot be rewritten');
select throws_ok($$ delete from private.table_group_events where tenant_id = (select t1 from scope) $$,
  null, null, 'the history cannot be deleted');
select is((select count(*)::int from private.audit_events where tenant_id = (select t1 from scope)
  and action in ('table_group.joined', 'table_group.separated')), 7, 'joining and separating are audited');
select is((select count(*)::int from private.table_group_events where tenant_id = (select t2 from scope)), 0, 'the other business has no history');
select throws_ok($$ select private.separate_tables((select t2 from scope), (select l2 from scope),
  '2e800000-0000-4000-8000-000000000001', '2ed00000-0000-4000-8000-000000000058',
  (select r ->> 'groupId' from joined4)::uuid, null) $$,
  'PT201', null, 'another business cannot see the group');

-- 73-78. Nothing in the session may be rewritten outside the two entry points.
select throws_ok($$ update private.table_sessions set scope_key = gen_random_uuid() where id = (select id from s1) $$,
  'PT209', null, 'a session cannot be re-scoped by hand');
select throws_ok($$ update private.table_sessions set table_id = '2e600000-0000-4000-8000-000000000004' where id = (select id from s1) $$,
  'PT209', null, 'a session cannot be moved to another table by hand');
select is((select count(*)::int from private.table_sessions where tenant_id = (select t1 from scope)), 5, 'no session was created or lost by joining and separating');
select is((select count(distinct scope_key)::int from private.table_sessions where tenant_id = (select t1 from scope) and status = 'open'), 0, 'every account is closed at the end');
select is((select count(*)::int from private.floor_group_members where tenant_id = (select t1 from scope)), 0, 'no table is left in a group');
select is((select (private.account_summary((select t1 from scope), (select l1 from scope), (select id from s1)) ->> 'pendingCents')::int), 0, 'the first account ended settled');

select * from finish();
rollback;
