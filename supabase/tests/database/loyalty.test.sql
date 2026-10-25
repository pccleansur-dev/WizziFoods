begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(61);

insert into auth.users (id) values ('2d100000-0000-4000-8000-000000000001'), ('2d100000-0000-4000-8000-000000000002');
insert into public.tenants (id, slug, name, status) values
  ('2d200000-0000-4000-8000-000000000001', 'loyalty-one', 'Loyalty One', 'active'),
  ('2d200000-0000-4000-8000-000000000002', 'loyalty-two', 'Loyalty Two', 'active');
insert into public.tenant_memberships (tenant_id, user_id, role)
values ('2d200000-0000-4000-8000-000000000001', '2d100000-0000-4000-8000-000000000001', 'admin'),
  ('2d200000-0000-4000-8000-000000000002', '2d100000-0000-4000-8000-000000000002', 'admin');

create temporary table scope as select
  '2d200000-0000-4000-8000-000000000001'::uuid t1,
  (select id from public.locations where tenant_id = '2d200000-0000-4000-8000-000000000001') l1,
  '2d200000-0000-4000-8000-000000000002'::uuid t2,
  (select id from public.locations where tenant_id = '2d200000-0000-4000-8000-000000000002') l2;

select private.save_floor_plan(
  (select t1 from scope), (select l1 from scope),
  '2d100000-0000-4000-8000-000000000001',
  '2d300000-0000-4000-8000-000000000001', 0,
  jsonb_build_object(
    'floors', jsonb_build_array(jsonb_build_object(
      'id','2d400000-0000-4000-8000-000000000001','name','Planta baja','position',0,'shortName',null)),
    'sectors', jsonb_build_array(
      jsonb_build_object('id','2d500000-0000-4000-8000-000000000001','name','Salón','position',0),
      jsonb_build_object('id','2d500000-0000-4000-8000-000000000002','name','Patio','position',1)),
    'tables', (
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'label', t.label, 'sectorId', t.sector,
        'floorId','2d400000-0000-4000-8000-000000000001','shape','square',
        'x', t.x,'y',40,'width',100,'height',100,'rotation',0,'seatCount',4,
        'seatLayout','perimeter'))
      from (values
        ('2d600000-0000-4000-8000-000000000001','1','2d500000-0000-4000-8000-000000000001',40),
        ('2d600000-0000-4000-8000-000000000002','2','2d500000-0000-4000-8000-000000000001',200),
        ('2d600000-0000-4000-8000-000000000003','3','2d500000-0000-4000-8000-000000000001',360),
        ('2d600000-0000-4000-8000-000000000004','4','2d500000-0000-4000-8000-000000000002',520)
      ) as t(id, label, sector, x)),
    'groups', '[]'::jsonb
  )
);
insert into private.floor_groups (tenant_id, location_id, id, name, position)
values ((select t1 from scope), (select l1 from scope), '2d700000-0000-4000-8000-000000000001', 'Cumple', 0);
insert into private.floor_group_members (tenant_id, location_id, group_id, table_id, position)
values
  ((select t1 from scope), (select l1 from scope), '2d700000-0000-4000-8000-000000000001', '2d600000-0000-4000-8000-000000000002', 0),
  ((select t1 from scope), (select l1 from scope), '2d700000-0000-4000-8000-000000000001', '2d600000-0000-4000-8000-000000000003', 1);

create function pg_temp.member(username text, role text, sectors uuid[] default '{}')
returns uuid language sql as $$
  select (private.create_staff_member(
    (select t1 from scope), (select l1 from scope),
    '2d100000-0000-4000-8000-000000000001',
    username, initcap(username), role, 'scrypt-v1$c2FsdA$aGFzaA', sectors) ->> 'id')::uuid
$$;
create temporary table staff as select
  pg_temp.member('ana', 'waiter', array['2d500000-0000-4000-8000-000000000001'::uuid]) ana,
  pg_temp.member('luis', 'waiter', array['2d500000-0000-4000-8000-000000000002'::uuid]) luis,
  pg_temp.member('marta', 'manager') manager,
  pg_temp.member('coco', 'kitchen') kitchen;
insert into public.staff_members (id, tenant_id, location_id, username, display_name, role, created_by)
values ('2d800000-0000-4000-8000-000000000001', (select t2 from scope), (select l2 from scope),
  'otra', 'Otra', 'manager', '2d100000-0000-4000-8000-000000000001');

insert into private.location_publications (tenant_id, location_id, published_by)
values ((select t1 from scope), (select l1 from scope), '2d100000-0000-4000-8000-000000000001');
insert into private.published_catalogs (
  tenant_id, location_id, revision, source_draft_revision, snapshot, published_by
) values (
  (select t1 from scope), (select l1 from scope), 1, 1,
  jsonb_build_object(
    'baseRevision', null,
    'categories', jsonb_build_array(jsonb_build_object(
      'id','2da00000-0000-4000-8000-000000000001','position',0,
      'content',jsonb_build_array(jsonb_build_object('language','es','title','Todo','description','')))),
    'sectors', jsonb_build_array(
      jsonb_build_object('id','2da00000-0000-4000-8000-000000000002','position',0,'name','Cocina','kind','kitchen'),
      jsonb_build_object('id','2da00000-0000-4000-8000-000000000003','position',1,'name','Barra','kind','bar')),
    'products', (
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'categoryId','2da00000-0000-4000-8000-000000000001',
        'sectorId', p.sector, 'position', p.pos, 'priceCents', p.price, 'imageAssetId', null,
        'content', jsonb_build_array(jsonb_build_object('language','es','title',p.title,'description','')),
        'variants', '[]'::jsonb))
      from (values
        ('2db00000-0000-4000-8000-000000000001','2da00000-0000-4000-8000-000000000002',0,12500,'Milanesa'),
        ('2db00000-0000-4000-8000-000000000002','2da00000-0000-4000-8000-000000000003',1,4000,'Cerveza')
      ) as p(id, sector, pos, price, title))),
  '2d100000-0000-4000-8000-000000000001');
select private.ensure_payment_methods((select t1 from scope), (select l1 from scope));

create function pg_temp.line(n integer, product text, quantity integer default 1) returns jsonb language sql as $$
  select jsonb_build_object('lineId', '2dc00000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'),
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


create function pg_temp.visits(profile uuid, wanted text default 'credited') returns integer language sql as $$
  select count(*)::integer from private.loyalty_visits where profile_id = profile and status = wanted
$$;
-- Moves a session's opening back in time (the only way to test other days).
create function pg_temp.open_at(session uuid, moment timestamptz) returns void language plpgsql as $$
begin
  set local session_replication_role = replica;
  update private.table_sessions set opened_at = moment where id = session;
  set local session_replication_role = origin;
end;
$$;
create function pg_temp.link(session uuid, profile uuid) returns void language sql as $$
  insert into private.diner_session_links (tenant_id, location_id, session_id, profile_id)
  values ((select t1 from scope), (select l1 from scope), session, profile)
$$;
create function pg_temp.sess(table_id text) returns uuid language sql as $$ select pg_temp.session_of(table_id) $$;
create function pg_temp.settle(staff uuid, command text, session uuid) returns jsonb language plpgsql as $$
declare paid jsonb;
begin
  paid := pg_temp.pay(staff, command, session, 'cash');
  perform pg_temp.close_session(staff, md5(command || 'c')::uuid::text, session);
  return paid;
end;
$$;

-- Accounts and profiles: Ana, Beto and Carla at tenant one, Ana also at tenant two.
create temporary table acc as select
  private.upsert_diner_account(repeat('a', 64), 'ana@example.com') ana,
  private.upsert_diner_account(repeat('b', 64), 'beto@example.com') beto,
  private.upsert_diner_account(repeat('c', 64), 'carla@example.com') carla;
select private.save_diner_profile((select t1 from scope), (select ana from acc), 'Ana', null);
select private.save_diner_profile((select t1 from scope), (select beto from acc), 'Beto', null);
select private.save_diner_profile((select t1 from scope), (select carla from acc), 'Carla', null);
select private.save_diner_profile((select t2 from scope), (select ana from acc), 'Ana Dos', null);
create temporary table prof as select
  private.diner_profile_id_of((select t1 from scope), (select ana from acc)) ana,
  private.diner_profile_id_of((select t1 from scope), (select beto from acc)) beto,
  private.diner_profile_id_of((select t1 from scope), (select carla from acc)) carla,
  private.diner_profile_id_of((select t2 from scope), (select ana from acc)) ana2;

select private.open_cash_shift((select t1 from scope), (select l1 from scope), (select manager from staff),
  '2dd00000-0000-4000-8000-000000000001', 0);

-- 1. Entry points reachable, internals and tables closed to the runtime.
select ok(
  not has_table_privilege('authenticator', 'private.loyalty_visits', 'select')
    and not has_table_privilege('authenticator', 'private.loyalty_rewards', 'select')
    and not has_table_privilege('authenticator', 'private.diner_birthdays', 'select')
    and not has_function_privilege('authenticator', 'private.credit_session_visits(uuid,uuid,uuid)', 'execute')
    and not has_function_privilege('authenticator', 'private.revoke_session_visits(uuid,uuid,uuid)', 'execute')
    and has_function_privilege('authenticator', 'private.reserve_loyalty_reward(uuid,uuid,uuid,uuid,uuid)', 'execute')
    and has_function_privilege('authenticator', 'private.redeem_loyalty_reward_with_payment(uuid,uuid,uuid,uuid,uuid,uuid,text,integer)', 'execute'),
  'only the entry points are reachable');

-- 2. Settings: manager only, validated, per tenant.
create function pg_temp.settings(over jsonb) returns jsonb language sql as $$
  select jsonb_build_object('enabled', true, 'minSpendCents', 5000, 'minSessionMinutes', 0,
    'visitsGoal', 2, 'rewardKind', 'percent', 'rewardValue', 1000, 'rewardValidDays', 90,
    'reservationMinutes', 30, 'birthdayMinAgeDays', 30, 'birthdayMaxChanges', 1) || over
$$;
select throws_ok($$ select private.save_loyalty_settings((select t1 from scope), (select l1 from scope), (select ana from staff), pg_temp.settings('{}')) $$,
  'PT222', null, 'a waiter cannot change the program');
select throws_ok($$ select private.save_loyalty_settings((select t1 from scope), (select l1 from scope), (select manager from staff), pg_temp.settings('{"visitsGoal":0}')) $$,
  'PT291', null, 'a zero goal is invalid');
select throws_ok($$ select private.save_loyalty_settings((select t1 from scope), (select l1 from scope), (select manager from staff), pg_temp.settings('{"rewardKind":"percent","rewardValue":10001}')) $$,
  'PT291', null, 'a percent above 100 is invalid');
select is(private.get_loyalty_settings((select t1 from scope), (select l1 from scope), (select manager from staff)) ->> 'enabled', 'false',
  'the program starts off');

-- 3. With the program off, a closed account credits nothing.
select pg_temp.manual('2de00000-0000-4000-8000-000000000001', '2d600000-0000-4000-8000-000000000001',
  jsonb_build_array(pg_temp.line(1, '2db00000-0000-4000-8000-000000000001', 1), pg_temp.line(2, '2db00000-0000-4000-8000-000000000002', 1)));
create temporary table sa as select pg_temp.sess('2d600000-0000-4000-8000-000000000001') id;
select pg_temp.link((select id from sa), (select ana from prof));
create temporary table paya as select pg_temp.settle((select ana from staff), '2de00000-0000-4000-8000-000000000002', (select id from sa)) r;
select is(pg_temp.visits((select ana from prof)), 0, 'a program that is off credits no visit');
select pg_temp.clean((select ana from staff), '2de00000-0000-4000-8000-000000000003', '2d600000-0000-4000-8000-000000000001');

select is(private.save_loyalty_settings((select t1 from scope), (select l1 from scope), (select manager from staff), pg_temp.settings('{}')) ->> 'minSpendCents', '5000',
  'the manager saves the program');
select is(private.loyalty_settings_json((select t2 from scope), (select l2 from scope)) ->> 'enabled', 'false',
  'tenant two is untouched by tenant one settings');

-- 4. Time zones: the local day of the location, not of the server.
select is(private.loyalty_local_day((select l1 from scope), '2026-10-26 02:30:00+00'), '2026-10-25'::date,
  'half past two UTC is still the 25th in Buenos Aires');
select is(private.loyalty_local_day((select l1 from scope), '2026-10-26 03:00:00+00'), '2026-10-26'::date,
  'three UTC is already the 26th in Buenos Aires');
update public.locations set timezone = 'Asia/Tokyo' where id = (select l1 from scope);
select is(private.loyalty_local_day((select l1 from scope), '2026-10-26 02:30:00+00'), '2026-10-26'::date,
  'the same instant is the 26th in Tokyo');
update public.locations set timezone = 'America/Argentina/Buenos_Aires' where id = (select l1 from scope);

-- 5. A real visit: one person, one account, over the minimum.
select pg_temp.manual('2de00000-0000-4000-8000-000000000004', '2d600000-0000-4000-8000-000000000001',
  jsonb_build_array(pg_temp.line(3, '2db00000-0000-4000-8000-000000000001', 1), pg_temp.line(4, '2db00000-0000-4000-8000-000000000002', 1)));
create temporary table sb as select pg_temp.sess('2d600000-0000-4000-8000-000000000001') id;
select pg_temp.open_at((select id from sb), now() - interval '3 days');
select pg_temp.link((select id from sb), (select ana from prof));
create temporary table payb as select pg_temp.settle((select ana from staff), '2de00000-0000-4000-8000-000000000005', (select id from sb)) r;
select is(pg_temp.visits((select ana from prof)), 1, 'an account over the minimum credits one visit');
select is((select net_cents from private.loyalty_visits where profile_id = (select ana from prof)), 16500, 'the visit carries the net consumption');
select is((select local_day from private.loyalty_visits where profile_id = (select ana from prof)),
  private.loyalty_local_day((select l1 from scope), now() - interval '3 days'), 'the visit is dated by the local day of the location');
select pg_temp.clean((select ana from staff), '2de00000-0000-4000-8000-000000000006', '2d600000-0000-4000-8000-000000000001');

-- 6. At most one visit per person and day.
select pg_temp.manual('2de00000-0000-4000-8000-000000000007', '2d600000-0000-4000-8000-000000000001',
  jsonb_build_array(pg_temp.line(5, '2db00000-0000-4000-8000-000000000001', 1), pg_temp.line(6, '2db00000-0000-4000-8000-000000000002', 1)));
create temporary table sc as select pg_temp.sess('2d600000-0000-4000-8000-000000000001') id;
select pg_temp.open_at((select id from sc), now() - interval '3 days' + interval '1 hour');
select pg_temp.link((select id from sc), (select ana from prof));
select pg_temp.settle((select ana from staff), '2de00000-0000-4000-8000-000000000008', (select id from sc));
select is(pg_temp.visits((select ana from prof)), 1, 'a second account the same day credits nothing');
select is(pg_temp.visits((select ana from prof), 'revoked'), 0, 'and nothing was revoked either');
select pg_temp.clean((select ana from staff), '2de00000-0000-4000-8000-000000000009', '2d600000-0000-4000-8000-000000000001');

-- 7. Minimum spend: a small account is not a visit.
select pg_temp.manual('2de00000-0000-4000-8000-00000000000a', '2d600000-0000-4000-8000-000000000001',
  jsonb_build_array(pg_temp.line(7, '2db00000-0000-4000-8000-000000000002', 1)));
create temporary table sd as select pg_temp.sess('2d600000-0000-4000-8000-000000000001') id;
select pg_temp.link((select id from sd), (select beto from prof));
select pg_temp.settle((select ana from staff), '2de00000-0000-4000-8000-00000000000b', (select id from sd));
select is(pg_temp.visits((select beto from prof)), 0, 'an account under the minimum credits nothing');
select pg_temp.clean((select ana from staff), '2de00000-0000-4000-8000-00000000000c', '2d600000-0000-4000-8000-000000000001');

-- 8. A 100% discount is not consumption.
select pg_temp.manual('2de00000-0000-4000-8000-00000000000d', '2d600000-0000-4000-8000-000000000001',
  jsonb_build_array(pg_temp.line(8, '2db00000-0000-4000-8000-000000000001', 1)));
create temporary table se as select pg_temp.sess('2d600000-0000-4000-8000-000000000001') id;
select pg_temp.link((select id from se), (select carla from prof));
select private.apply_account_discount((select t1 from scope), (select l1 from scope), (select manager from staff),
  '2de00000-0000-4000-8000-00000000000e', (select id from se), 'percent', 10000, 'Invitación');
select pg_temp.close_session((select ana from staff), '2de00000-0000-4000-8000-00000000000f', (select id from se));
select is(pg_temp.visits((select carla from prof)), 0, 'an account that was entirely discounted credits nothing');
select pg_temp.clean((select ana from staff), '2de00000-0000-4000-8000-000000000010', '2d600000-0000-4000-8000-000000000001');

-- 9. Group account (tables 2 and 3): shared in equal parts between the linked people.
select pg_temp.manual('2de00000-0000-4000-8000-000000000011', '2d600000-0000-4000-8000-000000000002',
  jsonb_build_array(pg_temp.line(9, '2db00000-0000-4000-8000-000000000001', 1), pg_temp.line(10, '2db00000-0000-4000-8000-000000000002', 1)));
create temporary table sg as select pg_temp.sess('2d700000-0000-4000-8000-000000000001') id;
select ok((select id is not null from sg), 'the group has one session');
select pg_temp.open_at((select id from sg), now() - interval '2 days');
select pg_temp.link((select id from sg), (select ana from prof));
select pg_temp.link((select id from sg), (select beto from prof));
create temporary table payg as select pg_temp.settle((select ana from staff), '2de00000-0000-4000-8000-000000000012', (select id from sg)) r;
select is(pg_temp.visits((select beto from prof)), 1, 'a group member credits a visit');
select is((select net_cents from private.loyalty_visits where profile_id = (select beto from prof)), 8250, 'with their equal part of the account');
select is(pg_temp.visits((select ana from prof)), 2, 'the other member too, on another day');
select ok((select bool_and(reward_id is not null) from private.loyalty_visits where profile_id = (select ana from prof)),
  'two visits reach the goal and unlock a reward');
select pg_temp.clean((select ana from staff), '2de00000-0000-4000-8000-000000000013', '2d600000-0000-4000-8000-000000000002');
select pg_temp.clean((select ana from staff), '2de00000-0000-4000-8000-000000000014', '2d600000-0000-4000-8000-000000000003');

-- 10. Too many people sharing a small account: nobody reaches the minimum.
select pg_temp.manual('2de00000-0000-4000-8000-000000000015', '2d600000-0000-4000-8000-000000000001',
  jsonb_build_array(pg_temp.line(11, '2db00000-0000-4000-8000-000000000001', 1)));
create temporary table sh as select pg_temp.sess('2d600000-0000-4000-8000-000000000001') id;
select pg_temp.link((select id from sh), (select beto from prof));
select pg_temp.link((select id from sh), (select carla from prof));
select pg_temp.link((select id from sh), (select ana from prof));
select pg_temp.settle((select ana from staff), '2de00000-0000-4000-8000-000000000016', (select id from sh));
select is((select count(*)::integer from private.loyalty_visits where session_id = (select id from sh)), 0, 'a part below the minimum credits no one');
select pg_temp.clean((select ana from staff), '2de00000-0000-4000-8000-000000000017', '2d600000-0000-4000-8000-000000000001');

-- 11. Isolation between restaurants.
select is(jsonb_array_length(private.get_diner_loyalty((select t1 from scope), (select l1 from scope), (select ana from acc)) -> 'rewards'), 1,
  'Ana sees her reward at restaurant one');
select is((private.get_diner_loyalty((select t2 from scope), (select l2 from scope), (select ana from acc)) ->> 'visits')::integer, 0,
  'restaurant two sees none of those visits');
select is((select count(*)::integer from private.loyalty_visits where tenant_id = (select t2 from scope)), 0,
  'no visit was written at tenant two');
select throws_ok($$ select private.reserve_loyalty_reward((select t2 from scope), (select l2 from scope), (select ana from acc),
  (select id from private.loyalty_rewards where profile_id = (select ana from prof)), (select id from sa)) $$,
  'PT287', null, 'a reward of one restaurant cannot be used at another');

-- 12. Reserving a reward for the account the diner is sitting at.
select pg_temp.manual('2de00000-0000-4000-8000-00000000001c', '2d600000-0000-4000-8000-000000000001',
  jsonb_build_array(pg_temp.line(13, '2db00000-0000-4000-8000-000000000001', 1), pg_temp.line(14, '2db00000-0000-4000-8000-000000000001', 1)));
create temporary table sr as select pg_temp.sess('2d600000-0000-4000-8000-000000000001') id;
create temporary table rw as select id from private.loyalty_rewards where profile_id = (select ana from prof) and status = 'available';
select throws_ok($$ select private.reserve_loyalty_reward((select t1 from scope), (select l1 from scope), (select ana from acc), (select id from rw), (select id from sr)) $$,
  'PT292', null, 'a diner who is not linked to the account cannot reserve');
select pg_temp.link((select id from sr), (select ana from prof));
select pg_temp.link((select id from sr), (select beto from prof));
select throws_ok($$ select private.reserve_loyalty_reward((select t1 from scope), (select l1 from scope), (select beto from acc), (select id from rw), (select id from sr)) $$,
  'PT290', null, 'another diner cannot reserve Ana reward');
select is(private.reserve_loyalty_reward((select t1 from scope), (select l1 from scope), (select ana from acc), (select id from rw), (select id from sr)) ->> 'discountCents',
  '2500', 'reserving previews a 10% discount of the 25000 balance');
select throws_ok($$ select private.reserve_loyalty_reward((select t1 from scope), (select l1 from scope), (select ana from acc), (select id from rw), (select id from sr)) $$,
  'PT290', null, 'a reserved reward cannot be reserved twice');
select is((select status from private.loyalty_rewards where id = (select id from rw)), 'reserved', 'it is held for this account');
select is((private.account_summary((select t1 from scope), (select l1 from scope), (select id from sr)) ->> 'discountCents')::integer, 0,
  'reserving writes nothing in the ledger');
select is(jsonb_array_length(private.session_loyalty_rewards((select t1 from scope), (select l1 from scope), (select ana from staff), (select id from sr))), 1,
  'the waiter sees the reserved reward');

-- 13. A payment that fails releases the reward and leaves the ledger untouched.
create temporary table failed as select private.redeem_loyalty_reward_with_payment(
  (select t1 from scope), (select l1 from scope), (select ana from staff), '2de00000-0000-4000-8000-00000000001d',
  (select id from sr), (select id from rw), 'bogus_method', 0) r;
select is((select r ->> 'released' from failed), 'true', 'a failed payment reports the release');
select is((select status from private.loyalty_rewards where id = (select id from rw)), 'available', 'the reward is available again');
select is((private.account_summary((select t1 from scope), (select l1 from scope), (select id from sr)) ->> 'discountCents')::integer, 0,
  'no discount stayed in the ledger');
select is(private.redeem_loyalty_reward_with_payment((select t1 from scope), (select l1 from scope), (select ana from staff),
  '2de00000-0000-4000-8000-00000000001d', (select id from sr), (select id from rw), 'bogus_method', 0), (select r from failed),
  'the same command returns the same result');

-- 14. Reserve again and redeem with a good payment, in the same purchase.
select private.reserve_loyalty_reward((select t1 from scope), (select l1 from scope), (select ana from acc), (select id from rw), (select id from sr));
create temporary table okr as select private.redeem_loyalty_reward_with_payment(
  (select t1 from scope), (select l1 from scope), (select ana from staff), '2de00000-0000-4000-8000-00000000001e',
  (select id from sr), (select id from rw), 'cash', 0) r;
select is((select r ->> 'redeemed' from okr), 'true', 'the reward is redeemed with the payment');
select is((select r ->> 'pendingCents' from okr), '0', 'the account is settled in the same purchase');
select is((select status from private.loyalty_rewards where id = (select id from rw)), 'redeemed', 'the reward is used');
select is((private.account_summary((select t1 from scope), (select l1 from scope), (select id from sr)) ->> 'discountCents')::integer, 2500,
  'the discount is in the ledger once');
select throws_ok($$ select private.redeem_loyalty_reward_with_payment((select t1 from scope), (select l1 from scope), (select ana from staff),
  '2de00000-0000-4000-8000-00000000001f', (select id from sr), (select id from rw), 'cash', 0) $$,
  'PT290', null, 'a used reward cannot be redeemed again');
select pg_temp.close_session((select ana from staff), '2de00000-0000-4000-8000-000000000020', (select id from sr));
select pg_temp.clean((select ana from staff), '2de00000-0000-4000-8000-000000000021', '2d600000-0000-4000-8000-000000000001');

-- 15. A total refund revokes the visit and the unused reward it unlocked (Beto).
select pg_temp.manual('2de00000-0000-4000-8000-000000000022', '2d600000-0000-4000-8000-000000000004',
  jsonb_build_array(pg_temp.line(15, '2db00000-0000-4000-8000-000000000001', 1), pg_temp.line(16, '2db00000-0000-4000-8000-000000000002', 1)));
create temporary table sj as select pg_temp.sess('2d600000-0000-4000-8000-000000000004') id;
select pg_temp.open_at((select id from sj), now() - interval '1 day');
select pg_temp.link((select id from sj), (select beto from prof));
select pg_temp.settle((select manager from staff), '2de00000-0000-4000-8000-000000000023', (select id from sj));
select is(pg_temp.visits((select beto from prof)), 3, 'Beto has three visits');
select is((select count(*)::integer from private.loyalty_rewards where profile_id = (select beto from prof) and status = 'available'), 1,
  'and an available reward');
-- The refund of a closed account arrives from the online refund path; the ledger takes it as a movement.
insert into private.account_entries (tenant_id, location_id, session_id, kind, amount_cents, origin, cause,
  source_type, source_id, actor_type, payment_method, refund_of_source_id)
select (select t1 from scope), (select l1 from scope), (select id from sg), 'refund', 16500, 'refund', 'Devolución en Mercado Pago',
  'refund', gen_random_uuid(), 'system', 'mercado_pago', (r ->> 'paymentId')::uuid from payg;
select is(pg_temp.visits((select beto from prof), 'revoked'), 1, 'a total refund revokes the visit');
select is((select count(*)::integer from private.loyalty_rewards where profile_id = (select beto from prof) and status = 'revoked'), 1,
  'and the unused reward it unlocked');
select is((select count(*)::integer from private.loyalty_visits where profile_id = (select beto from prof) and status = 'credited' and reward_id is null), 2,
  'the other visits count again toward the next reward');
select is(pg_temp.visits((select ana from prof), 'revoked'), 1, 'the other group member lost the same visit');
select is((select status from private.loyalty_rewards where id = (select id from rw)), 'redeemed', 'a reward already redeemed stays redeemed');
select throws_ok($$ update private.loyalty_visits set net_cents = 1 where profile_id = (select beto from prof) $$,
  'PT209', null, 'a visit is never rewritten');

-- 16. Birthday: seniority and change limit.
select throws_ok($$ select private.save_diner_birthday((select t1 from scope), (select l1 from scope), (select carla from acc), 3, 14) $$,
  'PT288', null, 'a brand new profile cannot set a birthday');
update private.diner_profiles set created_at = now() - interval '40 days' where tenant_id = (select t1 from scope);
select is(private.save_diner_birthday((select t1 from scope), (select l1 from scope), (select carla from acc), 2, 29) ->> 'month', '2',
  '29 February is accepted');
select throws_ok($$ select private.save_diner_birthday((select t1 from scope), (select l1 from scope), (select carla from acc), 2, 30) $$,
  'PT291', null, '30 February is not');
select throws_ok($$ select private.save_diner_birthday((select t1 from scope), (select l1 from scope), (select carla from acc), 4, 31) $$,
  'PT291', null, '31 April is not');
select is(private.save_diner_birthday((select t1 from scope), (select l1 from scope), (select carla from acc), 3, 14) ->> 'changes', '1',
  'one change is allowed');
select throws_ok($$ select private.save_diner_birthday((select t1 from scope), (select l1 from scope), (select carla from acc), 5, 1) $$,
  'PT289', null, 'the change limit holds');
select is(private.save_diner_birthday((select t1 from scope), (select l1 from scope), (select carla from acc), 3, 14) ->> 'changes', '1',
  'repeating the same date is harmless');

-- 17. Nothing the restaurant or the diner sees carries the email or the account.
select is((select count(*)::integer from jsonb_array_elements(private.list_tenant_diner_profiles((select t1 from scope))) p
  where p::text ~* '(example\.com|account|email)'), 0, 'the restaurant still sees no email');
select is((private.get_diner_loyalty((select t1 from scope), (select l1 from scope), (select ana from acc)))::text ~* '(example\.com|accountId|email)',
  false, 'the diner loyalty view carries no email or account id');

select * from finish();
rollback;
