begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(59);

insert into auth.users (id) values ('2c100000-0000-4000-8000-000000000001'), ('2c100000-0000-4000-8000-000000000002');
insert into public.tenants (id, slug, name, status) values
  ('2c200000-0000-4000-8000-000000000001', 'close-one', 'Close One', 'active'),
  ('2c200000-0000-4000-8000-000000000002', 'close-two', 'Close Two', 'active');
insert into public.tenant_memberships (tenant_id, user_id, role)
values ('2c200000-0000-4000-8000-000000000001', '2c100000-0000-4000-8000-000000000001', 'admin'),
  ('2c200000-0000-4000-8000-000000000002', '2c100000-0000-4000-8000-000000000002', 'admin');

create temporary table scope as select
  '2c200000-0000-4000-8000-000000000001'::uuid t1,
  (select id from public.locations where tenant_id = '2c200000-0000-4000-8000-000000000001') l1,
  '2c200000-0000-4000-8000-000000000002'::uuid t2,
  (select id from public.locations where tenant_id = '2c200000-0000-4000-8000-000000000002') l2;

select private.save_floor_plan(
  (select t1 from scope), (select l1 from scope),
  '2c100000-0000-4000-8000-000000000001',
  '2c300000-0000-4000-8000-000000000001', 0,
  jsonb_build_object(
    'floors', jsonb_build_array(jsonb_build_object(
      'id','2c400000-0000-4000-8000-000000000001','name','Planta baja','position',0,'shortName',null)),
    'sectors', jsonb_build_array(
      jsonb_build_object('id','2c500000-0000-4000-8000-000000000001','name','Salón','position',0),
      jsonb_build_object('id','2c500000-0000-4000-8000-000000000002','name','Patio','position',1)),
    'tables', (
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'label', t.label, 'sectorId', t.sector,
        'floorId','2c400000-0000-4000-8000-000000000001','shape','square',
        'x', t.x,'y',40,'width',100,'height',100,'rotation',0,'seatCount',4,
        'seatLayout','perimeter'))
      from (values
        ('2c600000-0000-4000-8000-000000000001','1','2c500000-0000-4000-8000-000000000001',40),
        ('2c600000-0000-4000-8000-000000000002','2','2c500000-0000-4000-8000-000000000001',200),
        ('2c600000-0000-4000-8000-000000000003','3','2c500000-0000-4000-8000-000000000001',360),
        ('2c600000-0000-4000-8000-000000000004','4','2c500000-0000-4000-8000-000000000002',520)
      ) as t(id, label, sector, x)),
    'groups', '[]'::jsonb
  )
);
insert into private.floor_groups (tenant_id, location_id, id, name, position)
values ((select t1 from scope), (select l1 from scope), '2c700000-0000-4000-8000-000000000001', 'Cumple', 0);
insert into private.floor_group_members (tenant_id, location_id, group_id, table_id, position)
values
  ((select t1 from scope), (select l1 from scope), '2c700000-0000-4000-8000-000000000001', '2c600000-0000-4000-8000-000000000002', 0),
  ((select t1 from scope), (select l1 from scope), '2c700000-0000-4000-8000-000000000001', '2c600000-0000-4000-8000-000000000003', 1);

create function pg_temp.member(username text, role text, sectors uuid[] default '{}')
returns uuid language sql as $$
  select (private.create_staff_member(
    (select t1 from scope), (select l1 from scope),
    '2c100000-0000-4000-8000-000000000001',
    username, initcap(username), role, 'scrypt-v1$c2FsdA$aGFzaA', sectors) ->> 'id')::uuid
$$;
create temporary table staff as select
  pg_temp.member('ana', 'waiter', array['2c500000-0000-4000-8000-000000000001'::uuid]) ana,
  pg_temp.member('luis', 'waiter', array['2c500000-0000-4000-8000-000000000002'::uuid]) luis,
  pg_temp.member('marta', 'manager') manager,
  pg_temp.member('coco', 'kitchen') kitchen;
insert into public.staff_members (id, tenant_id, location_id, username, display_name, role, created_by)
values ('2c800000-0000-4000-8000-000000000001', (select t2 from scope), (select l2 from scope),
  'otra', 'Otra', 'manager', '2c100000-0000-4000-8000-000000000001');

insert into private.location_publications (tenant_id, location_id, published_by)
values ((select t1 from scope), (select l1 from scope), '2c100000-0000-4000-8000-000000000001');
insert into private.published_catalogs (
  tenant_id, location_id, revision, source_draft_revision, snapshot, published_by
) values (
  (select t1 from scope), (select l1 from scope), 1, 1,
  jsonb_build_object(
    'baseRevision', null,
    'categories', jsonb_build_array(jsonb_build_object(
      'id','2ca00000-0000-4000-8000-000000000001','position',0,
      'content',jsonb_build_array(jsonb_build_object('language','es','title','Todo','description','')))),
    'sectors', jsonb_build_array(
      jsonb_build_object('id','2ca00000-0000-4000-8000-000000000002','position',0,'name','Cocina','kind','kitchen'),
      jsonb_build_object('id','2ca00000-0000-4000-8000-000000000003','position',1,'name','Barra','kind','bar')),
    'products', (
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'categoryId','2ca00000-0000-4000-8000-000000000001',
        'sectorId', p.sector, 'position', p.pos, 'priceCents', p.price, 'imageAssetId', null,
        'content', jsonb_build_array(jsonb_build_object('language','es','title',p.title,'description','')),
        'variants', '[]'::jsonb))
      from (values
        ('2cb00000-0000-4000-8000-000000000001','2ca00000-0000-4000-8000-000000000002',0,12500,'Milanesa'),
        ('2cb00000-0000-4000-8000-000000000002','2ca00000-0000-4000-8000-000000000003',1,4000,'Cerveza')
      ) as p(id, sector, pos, price, title))),
  '2c100000-0000-4000-8000-000000000001');
select private.ensure_payment_methods((select t1 from scope), (select l1 from scope));

create function pg_temp.line(n integer, product text, quantity integer default 1) returns jsonb language sql as $$
  select jsonb_build_object('lineId', '2cc00000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'),
    'productId', product, 'variantId', null, 'quantity', quantity)
$$;
create function pg_temp.manual(command text, table_id text, items jsonb) returns jsonb language sql as $$
  select private.create_manual_order((select t1 from scope), (select l1 from scope),
    (select manager from staff), command::uuid, table_id::uuid, 'table', null, null, items)
$$;
create function pg_temp.session_of(wanted text) returns uuid language sql as $$
  select s.id from private.table_sessions s where s.status = 'open' and s.scope_key = wanted::uuid
$$;
create function pg_temp.pay(staff uuid, command text, session uuid, method text, amount integer default null, tip integer default 0) returns jsonb language sql as $$
  select private.record_account_payment((select t1 from scope), (select l1 from scope), staff, command::uuid, session, method, amount, tip)
$$;
create function pg_temp.close_session(staff uuid, command text, session uuid) returns jsonb language sql as $$
  select private.close_table_session((select t1 from scope), (select l1 from scope), staff, command::uuid, session)
$$;
create function pg_temp.clean(staff uuid, command text, table_id text) returns jsonb language sql as $$
  select private.mark_table_clean((select t1 from scope), (select l1 from scope), staff, command::uuid, table_id::uuid)
$$;
create function pg_temp.state_of(table_id text) returns text language sql as $$
  select private.waiter_table_state((select t1 from scope), (select l1 from scope), table_id::uuid)
$$;
create function pg_temp.receipt(staff uuid, session uuid) returns jsonb language sql as $$
  select private.account_receipt((select t1 from scope), (select l1 from scope), staff, session)
$$;
create function pg_temp.notify_cashier(staff uuid, command text, session uuid) returns jsonb language sql as $$
  select private.request_cashier((select t1 from scope), (select l1 from scope), staff, command::uuid, session)
$$;
create function pg_temp.split(staff uuid, command text, session uuid, parts integer) returns jsonb language sql as $$
  select private.create_account_split((select t1 from scope), (select l1 from scope), staff, command::uuid, session, parts)
$$;

-- 1. Only the entry points are reachable, and the new tables are closed to the runtime.
select ok(
  not has_table_privilege('authenticator', 'private.account_receipts', 'select')
    and not has_table_privilege('authenticator', 'private.cashier_requests', 'select')
    and has_function_privilege('authenticator', 'private.close_table_session(uuid,uuid,uuid,uuid,uuid)', 'execute')
    and has_function_privilege('authenticator', 'private.mark_table_clean(uuid,uuid,uuid,uuid,uuid)', 'execute')
    and has_function_privilege('authenticator', 'private.account_receipt(uuid,uuid,uuid,uuid)', 'execute')
    and has_function_privilege('authenticator', 'private.request_cashier(uuid,uuid,uuid,uuid,uuid)', 'execute'),
  'only the entry points are reachable');

-- Table 1: a loose table with an order of 16500 (milanesa + cerveza).
select private.open_cash_shift((select t1 from scope), (select l1 from scope), (select manager from staff),
  '2cd00000-0000-4000-8000-000000000001', 0);
select pg_temp.manual('2cd00000-0000-4000-8000-000000000002', '2c600000-0000-4000-8000-000000000001',
  jsonb_build_array(pg_temp.line(1, '2cb00000-0000-4000-8000-000000000001', 1), pg_temp.line(2, '2cb00000-0000-4000-8000-000000000002', 1)));
create temporary table s1 as select pg_temp.session_of('2c600000-0000-4000-8000-000000000001') id;

-- 2-3. A balance that is not zero keeps the session open.
select throws_ok($$ select pg_temp.close_session((select ana from staff), '2cd00000-0000-4000-8000-000000000003', (select id from s1)) $$,
  'PT270', null, 'a pending balance blocks the close');
select is((select status from private.table_sessions where id = (select id from s1)), 'open', 'the session stays open');

-- 4-5. Kitchen cannot close; a waiter of another sector does not see the session.
select pg_temp.pay((select ana from staff), '2cd00000-0000-4000-8000-000000000004', (select id from s1), 'cash', 10000, 1000);
select throws_ok($$ select pg_temp.close_session((select kitchen from staff), '2cd00000-0000-4000-8000-000000000005', (select id from s1)) $$,
  'PT200', null, 'kitchen cannot close an account');
select throws_ok($$ select pg_temp.close_session((select luis from staff), '2cd00000-0000-4000-8000-000000000006', (select id from s1)) $$,
  'PT201', null, 'a waiter of another sector cannot close it');

-- 6. A manager of another business cannot reach it either.
select throws_ok($$ select private.close_table_session((select t1 from scope), (select l1 from scope),
  '2c800000-0000-4000-8000-000000000001', '2cd00000-0000-4000-8000-000000000007', (select id from s1)) $$,
  'PT200', null, 'staff of another business cannot close it');

-- 7. An unpaid remainder still blocks, then the rest is paid.
select throws_ok($$ select pg_temp.close_session((select ana from staff), '2cd00000-0000-4000-8000-000000000008', (select id from s1)) $$,
  'PT270', null, 'the remainder still blocks the close');
select pg_temp.pay((select ana from staff), '2cd00000-0000-4000-8000-000000000009', (select id from s1), 'debit_card');

-- 8. An open split is voided when the account closes. (Created on table 4 below.)

-- 9-14. Closing a settled account.
create temporary table closed1 as select pg_temp.close_session((select ana from staff), '2cd00000-0000-4000-8000-00000000000a', (select id from s1)) r;
select is((select status from private.table_sessions where id = (select id from s1)), 'closed', 'the session is closed');
select ok((select closed_at is not null from private.table_sessions where id = (select id from s1)), 'it records when');
select is(pg_temp.state_of('2c600000-0000-4000-8000-000000000001'), 'needs_cleaning', 'the table is pending cleaning, not available');
select is((select r -> 'receipt' ->> 'number' from closed1), '1', 'the first receipt of the location is number 1');
select is((select r ->> 'sessionId' from closed1)::uuid, (select id from s1), 'the result names the session');
select throws_ok($$ select private.assert_table_accepts_orders((select t1 from scope), (select l1 from scope), '2c600000-0000-4000-8000-000000000001') $$,
  'PT210', null, 'the table accepts no order while pending cleaning');

-- 15. The same command returns the same result; a new command on a closed account is refused.
select is(pg_temp.close_session((select ana from staff), '2cd00000-0000-4000-8000-00000000000a', (select id from s1)), (select r from closed1), 'a retry returns the stored result');
select throws_ok($$ select pg_temp.close_session((select ana from staff), '2cd00000-0000-4000-8000-00000000000b', (select id from s1)) $$,
  'PT272', null, 'an account that is already closed cannot be closed again');
select is((select count(*)::int from private.account_receipts where session_id = (select id from s1)), 1, 'one receipt per session');

-- 17-22. The receipt.
create temporary table rc as select pg_temp.receipt((select ana from staff), (select id from s1)) r;
select is((select r ->> 'notice' from rc), 'Comprobante de consumo — no válido como factura', 'it says it is not an invoice');
select is((select r ->> 'invoiceNotice' from rc), '¿Necesitás factura? Por el momento, la facturación se realiza en caja', 'it points to the cashier for an invoice');
select is((select r -> 'summary' ->> 'consumedCents' from rc), '16500', 'it carries what was consumed');
select is((select r -> 'summary' ->> 'tipCents' from rc), '1000', 'it carries the tip');
select is((select r -> 'summary' ->> 'pendingCents' from rc), '0', 'the balance is zero');
select is((select jsonb_path_query_array(r, '$.payments[*].method') from rc), '["cash","debit_card"]'::jsonb, 'it lists the payment methods');
select is((select jsonb_array_length(r -> 'items') from rc), 2, 'it lists the items');
select is((select r -> 'tableLabels' from rc), '["1"]'::jsonb, 'it names the table');
select throws_ok($$ select pg_temp.receipt((select luis from staff), (select id from s1)) $$, 'PT201', null, 'a waiter outside the sector cannot read it');
select throws_ok($$ select private.account_receipt((select t2 from scope), (select l2 from scope), (select manager from staff), (select id from s1)) $$, 'PT200', null, 'another business cannot read it');

-- 25. The closed ledger is frozen (a refund after the close is still possible).
select throws_ok($$ insert into private.account_entries (tenant_id, location_id, session_id, kind, amount_cents, origin, cause, source_type, source_id, actor_type)
  values ((select t1 from scope), (select l1 from scope), (select id from s1), 'charge', 100, 'manual', 'Late', 'discount', gen_random_uuid(), 'system') $$,
  'PT273', null, 'a closed account takes no new charge');
select lives_ok($$ insert into private.account_entries (tenant_id, location_id, session_id, kind, amount_cents, origin, cause, source_type, source_id, actor_type, payment_method, refund_of_source_id)
  values ((select t1 from scope), (select l1 from scope), (select id from s1), 'refund', 100, 'refund', 'Late refund', 'refund', gen_random_uuid(), 'system', 'cash', gen_random_uuid()) $$,
  'but a refund can still be recorded');
select is(pg_temp.receipt((select ana from staff), (select id from s1)), (select r from rc), 'the receipt does not change afterwards');

-- 28-35. Cleaning: only authorised staff, only from pending cleaning.
select throws_ok($$ select pg_temp.clean((select kitchen from staff), '2cd00000-0000-4000-8000-000000000010', '2c600000-0000-4000-8000-000000000001') $$,
  'PT200', null, 'kitchen cannot mark a table clean');
select throws_ok($$ select pg_temp.clean((select luis from staff), '2cd00000-0000-4000-8000-000000000011', '2c600000-0000-4000-8000-000000000001') $$,
  'PT201', null, 'a waiter outside the sector cannot');
select throws_ok($$ select pg_temp.clean((select ana from staff), '2cd00000-0000-4000-8000-000000000012', '2c600000-0000-4000-8000-000000000003') $$,
  'PT274', null, 'a table that is not pending cleaning cannot be marked clean');
select lives_ok($$ select pg_temp.clean((select ana from staff), '2cd00000-0000-4000-8000-000000000013', '2c600000-0000-4000-8000-000000000001') $$, 'the waiter of the sector marks it clean');
select is(pg_temp.state_of('2c600000-0000-4000-8000-000000000001'), 'available', 'the table is available again');
select throws_ok($$ select pg_temp.clean((select ana from staff), '2cd00000-0000-4000-8000-000000000014', '2c600000-0000-4000-8000-000000000001') $$,
  'PT274', null, 'cleaning twice is refused');
select pg_temp.manual('2cd00000-0000-4000-8000-000000000015', '2c600000-0000-4000-8000-000000000001',
  jsonb_build_array(pg_temp.line(3, '2cb00000-0000-4000-8000-000000000002', 1)));
select isnt(pg_temp.session_of('2c600000-0000-4000-8000-000000000001'), (select id from s1), 'the next order opens a new session');

-- 36-37. The state machine rejects invalid transitions.
update private.floor_table_service_states set state = 'needs_cleaning'
where table_id = '2c600000-0000-4000-8000-000000000001';
select throws_ok($$ update private.floor_table_service_states set state = 'occupied'
  where table_id = '2c600000-0000-4000-8000-000000000001' $$, 'PT275', null, 'pending cleaning cannot become occupied');
update private.floor_table_service_states set state = 'out_of_service'
where table_id = '2c600000-0000-4000-8000-000000000001';
select throws_ok($$ update private.floor_table_service_states set state = 'needs_cleaning'
  where table_id = '2c600000-0000-4000-8000-000000000001' $$, 'PT275', null, 'out of service cannot become pending cleaning');
delete from private.floor_table_service_states where table_id = '2c600000-0000-4000-8000-000000000001';

-- 38-42. A group closes as one account and every table waits for cleaning; an open split is voided.
select pg_temp.manual('2cd00000-0000-4000-8000-000000000020', '2c600000-0000-4000-8000-000000000002',
  jsonb_build_array(pg_temp.line(4, '2cb00000-0000-4000-8000-000000000001', 1)));
create temporary table s2 as select pg_temp.session_of('2c700000-0000-4000-8000-000000000001') id;
select ok((select id from s2) is not null, 'the group has one session');
create temporary table sp as select pg_temp.split((select ana from staff), '2cd00000-0000-4000-8000-000000000021', (select id from s2), 2) r;
select pg_temp.pay((select ana from staff), '2cd00000-0000-4000-8000-000000000022', (select id from s2), 'cash');
create temporary table closed2 as select pg_temp.close_session((select manager from staff), '2cd00000-0000-4000-8000-000000000023', (select id from s2)) r;
select is((select status from private.account_splits where session_id = (select id from s2)), 'superseded', 'the open split is voided');
select is((select count(*)::int from private.account_split_shares where split_id in (select split.id from private.account_splits split where split.session_id = (select id from s2)) and status in ('open', 'claimed')), 0, 'no share stays open');
select is(pg_temp.state_of('2c600000-0000-4000-8000-000000000002') || ',' || pg_temp.state_of('2c600000-0000-4000-8000-000000000003'),
  'needs_cleaning,needs_cleaning', 'every table of the group waits for cleaning');
select is((select r -> 'receipt' ->> 'number' from closed2), '2', 'receipt numbers advance per location');

-- 43-44. A refund that must still be returned blocks the close.
select pg_temp.manual('2cd00000-0000-4000-8000-000000000030', '2c600000-0000-4000-8000-000000000004',
  jsonb_build_array(pg_temp.line(5, '2cb00000-0000-4000-8000-000000000002', 1)));
create temporary table s4 as select pg_temp.session_of('2c600000-0000-4000-8000-000000000004') id;
create temporary table sp4 as select pg_temp.split((select luis from staff), '2cd00000-0000-4000-8000-000000000031', (select id from s4), 2) r;
insert into private.online_payments (
  tenant_id, location_id, share_split_id, share_position, amount_cents, status,
  provider_payment_id, provider_status, fulfillment
) values (
  (select t1 from scope), (select l1 from scope), (select split.id from private.account_splits split where split.session_id = (select id from s4) and split.status = 'open'), 1, 2000,
  'approved', 'MP-T26-1', 'approved', 'needs_refund');
select pg_temp.pay((select luis from staff), '2cd00000-0000-4000-8000-000000000032', (select id from s4), 'cash');
select throws_ok($$ select pg_temp.close_session((select luis from staff), '2cd00000-0000-4000-8000-000000000033', (select id from s4)) $$,
  'PT271', null, 'an online payment waiting to be returned blocks the close');
update private.online_payments set fulfillment = 'closed', refunded_cents = amount_cents where provider_payment_id = 'MP-T26-1';
select lives_ok($$ select pg_temp.close_session((select luis from staff), '2cd00000-0000-4000-8000-000000000034', (select id from s4)) $$,
  'once it is returned the account closes');

-- 45-50. Notifying the cashier creates one internal request and no invoice data.
select throws_ok($$ select pg_temp.notify_cashier((select kitchen from staff), '2cd00000-0000-4000-8000-000000000040', (select id from s1)) $$, 'PT200', null, 'kitchen cannot notify the cashier');
create temporary table cr as select pg_temp.notify_cashier((select ana from staff), '2cd00000-0000-4000-8000-000000000041', (select id from s1)) r;
select is((select r ->> 'status' from cr), 'open', 'the request is open');
select is((select count(*)::int from private.cashier_requests where session_id = (select id from s1)), 1, 'one request was stored');
select is((select (pg_temp.notify_cashier((select ana from staff), '2cd00000-0000-4000-8000-000000000042', (select id from s1))) ->> 'requestId'), (select r ->> 'requestId' from cr), 'asking again reuses the open request');
select is((select count(*)::int from private.cashier_requests where session_id = (select id from s1)), 1, 'no duplicate request');
select ok(not exists (
  select 1 from information_schema.columns
  where table_schema = 'private' and table_name = 'cashier_requests'
    and column_name ~* '(cuit|tax|razon|domicilio|address|name)'), 'it stores no tax data');

-- Resolving the request is the manager's, and a later request is a new one.
select throws_ok($$ select private.resolve_cashier_request((select t1 from scope), (select l1 from scope),
  (select ana from staff), '2cd00000-0000-4000-8000-000000000043', (select (r ->> 'requestId')::uuid from cr)) $$,
  'PT222', null, 'a waiter cannot resolve a cashier request');
select is((select private.resolve_cashier_request((select t1 from scope), (select l1 from scope),
  (select manager from staff), '2cd00000-0000-4000-8000-000000000044', (select (r ->> 'requestId')::uuid from cr)) ->> 'status'),
  'resolved', 'the manager resolves it');
select is((pg_temp.receipt((select ana from staff), (select id from s1)) -> 'cashierRequest' ->> 'status'), 'resolved', 'the receipt shows it resolved');
select isnt((pg_temp.notify_cashier((select ana from staff), '2cd00000-0000-4000-8000-000000000045', (select id from s1)) ->> 'requestId'),
  (select r ->> 'requestId' from cr), 'a new request after resolving is a new one');

-- Closed accounts are listed within each person's reach.
select is((select jsonb_array_length(private.closed_accounts_view((select t1 from scope), (select l1 from scope), (select ana from staff)) -> 'accounts')), 2, 'the waiter sees the closed accounts of the salon sector');
select is((select jsonb_array_length(private.closed_accounts_view((select t1 from scope), (select l1 from scope), (select luis from staff)) -> 'accounts')), 1, 'another waiter sees only theirs');
select is((select jsonb_array_length(private.closed_accounts_view((select t1 from scope), (select l1 from scope), (select manager from staff)) -> 'accounts')), 3, 'the manager sees all of them');

select is((select count(*)::int from private.audit_events where tenant_id = (select t1 from scope) and action in
  ('table_session.closed', 'table.cleaned', 'cashier.requested')), 6, 'closing, cleaning and notifying are audited');

select * from finish();
rollback;
