begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(13);

insert into auth.users (id) values ('3e100000-0000-4000-8000-000000000001'), ('3e100000-0000-4000-8000-000000000002');
insert into public.tenants (id, slug, name, status) values
  ('3e200000-0000-4000-8000-000000000001', 'realtime-one', 'Realtime One', 'active'),
  ('3e200000-0000-4000-8000-000000000002', 'realtime-two', 'Realtime Two', 'active');
insert into public.tenant_memberships (tenant_id, user_id, role)
values ('3e200000-0000-4000-8000-000000000001', '3e100000-0000-4000-8000-000000000001', 'admin'),
  ('3e200000-0000-4000-8000-000000000002', '3e100000-0000-4000-8000-000000000002', 'admin');

create temporary table scope as select
  '3e200000-0000-4000-8000-000000000001'::uuid t1,
  (select id from public.locations where tenant_id = '3e200000-0000-4000-8000-000000000001') l1,
  '3e200000-0000-4000-8000-000000000002'::uuid t2,
  (select id from public.locations where tenant_id = '3e200000-0000-4000-8000-000000000002') l2;
create temporary table chan as select
  'tenant:' || t1 || ':location:' || l1 || ':salon' salon1,
  'tenant:' || t1 || ':location:' || l1 || ':production-kitchen' kitchen1,
  'tenant:' || t2 || ':location:' || l2 || ':salon' salon2
from scope;
grant select on scope, chan to authenticated;

-- A floor plan with one table: inserting its rows is what announces the change.
select private.save_floor_plan(
  (select t1 from scope), (select l1 from scope),
  '3e100000-0000-4000-8000-000000000001',
  '3e300000-0000-4000-8000-000000000001', 0,
  jsonb_build_object(
    'floors', jsonb_build_array(jsonb_build_object(
      'id','3e400000-0000-4000-8000-000000000001','name','Planta baja','position',0,'shortName',null)),
    'sectors', jsonb_build_array(
      jsonb_build_object('id','3e500000-0000-4000-8000-000000000001','name','Salón','position',0)),
    'tables', jsonb_build_array(jsonb_build_object(
      'id','3e600000-0000-4000-8000-000000000001','label','1','sectorId','3e500000-0000-4000-8000-000000000001',
      'floorId','3e400000-0000-4000-8000-000000000001','shape','square',
      'x',40,'y',40,'width',100,'height',100,'rotation',0,'seatCount',4,'seatLayout','perimeter'),
      jsonb_build_object(
      'id','3e600000-0000-4000-8000-000000000002','label','2','sectorId','3e500000-0000-4000-8000-000000000001',
      'floorId','3e400000-0000-4000-8000-000000000001','shape','square',
      'x',200,'y',40,'width',100,'height',100,'rotation',0,'seatCount',4,'seatLayout','perimeter')),
    'groups', '[]'::jsonb));

select is((select count(*) from realtime.messages where topic = (select salon1 from chan)), 1::bigint,
  'changing the floor announces the salon once, however many rows changed');
select is((select count(*) from realtime.messages where topic = (select salon2 from chan)), 0::bigint,
  'and says nothing on the other restaurant''s channel');
select is((select payload from realtime.messages where topic = (select salon1 from chan) limit 1) - 'at' - 'id', '{}'::jsonb,
  'the message carries no data, only that something changed');

select lives_ok($$select private.notify_realtime(null, null, 'salon')$$,
  'a notification that cannot be sent never fails the write');

-- Who may hear what: the channels come from the token, not from the topic.
create function pg_temp.visible(claims text, wanted text) returns boolean language plpgsql as $$
declare seen boolean;
begin
  perform set_config('request.jwt.claims', claims, true);
  perform set_config('realtime.topic', wanted, true);
  set local role authenticated;
  select count(*) > 0 into seen from realtime.messages;
  reset role;
  return seen;
end;
$$;

select is(pg_temp.visible(
  jsonb_build_object('role', 'authenticated', 'channels', jsonb_build_array((select salon1 from chan)))::text,
  (select salon1 from chan)), true, 'a token with the channel hears it');
select is(pg_temp.visible(
  jsonb_build_object('role', 'authenticated', 'channels', jsonb_build_array((select kitchen1 from chan)))::text,
  (select salon1 from chan)), false, 'a token for another channel of the same restaurant does not');
select is(pg_temp.visible(
  jsonb_build_object('role', 'authenticated', 'channels', jsonb_build_array((select salon2 from chan)))::text,
  (select salon1 from chan)), false, 'nor does one of another restaurant');
select is(pg_temp.visible(
  jsonb_build_object('role', 'authenticated', 'channels', jsonb_build_array((select salon1 from chan)))::text,
  (select salon2 from chan)), false, 'and having a channel does not open the neighbouring topic');
select is(pg_temp.visible(
  jsonb_build_object('role', 'authenticated', 'sub', gen_random_uuid())::text,
  (select salon1 from chan)), false, 'a signed-in user with no channels hears nothing');
select is(pg_temp.visible(
  jsonb_build_object('role', 'authenticated', 'channels', 'salon')::text,
  (select salon1 from chan)), false, 'a malformed channels claim hears nothing');

-- Nobody writes from a browser.
select is(pg_temp.visible('{"role":"anon"}', (select salon1 from chan)), false, 'anonymous hears nothing');
set local role authenticated;
select throws_ok(
  $$insert into realtime.messages (topic, extension, payload, event, private) values ('x', 'broadcast', '{}', 'changed', true)$$,
  '42501', null, 'a signed-in user cannot write to a channel');
reset role;

-- The production screens have a channel per sector kind.
select is(
  (select count(*) from pg_trigger where tgname in (
    'production_items_realtime', 'waiter_calls_realtime', 'order_intents_realtime', 'confirmed_orders_realtime',
    'table_sessions_realtime', 'cashier_requests_realtime', 'account_entries_realtime', 'cash_shifts_realtime',
    'cash_movements_realtime', 'floor_tables_realtime', 'table_group_events_realtime')),
  11::bigint, 'every table the screens read announces its changes');

select * from finish();
rollback;
