begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(8);

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
  'tenant:' || t2 || ':location:' || l2 || ':salon' salon2,
  'tenant:' || t1 || ':location:' || l1 || ':table-3e600000-0000-4000-8000-000000000001' table1,
  'tenant:' || t1 || ':location:' || l1 || ':table-3e600000-0000-4000-8000-000000000002' table2
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

delete from realtime.messages;

-- The diner of table 1 hears table 1 only.
insert into private.floor_table_service_states (tenant_id, location_id, table_id, state)
values ((select t1 from scope), (select l1 from scope), '3e600000-0000-4000-8000-000000000001', 'occupied')
on conflict (tenant_id, location_id, table_id) do update set state = excluded.state;
select is((select count(*) from realtime.messages where topic = (select table1 from chan)), 1::bigint,
  'a change of the table''s service state announces that table');
select is((select count(*) from realtime.messages where topic = (select table2 from chan)), 0::bigint,
  'and not the table next to it');
select is((select payload from realtime.messages where topic = (select table1 from chan) limit 1) - 'at' - 'id', '{}'::jsonb,
  'the message carries no data');

update private.floor_table_service_states set state = 'needs_cleaning'
where tenant_id = (select t1 from scope) and table_id = '3e600000-0000-4000-8000-000000000001';
select is((select count(*) from realtime.messages where topic = (select table1 from chan)), 1::bigint,
  'within one transaction the table is announced once, however many rows changed');

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
  jsonb_build_object('role', 'authenticated', 'channels', jsonb_build_array((select table1 from chan)))::text,
  (select table1 from chan)), true, 'a phone with its table''s channel hears it');
select is(pg_temp.visible(
  jsonb_build_object('role', 'authenticated', 'channels', jsonb_build_array((select table1 from chan)))::text,
  (select table2 from chan)), false, 'but not the neighbouring table''s');
select is(pg_temp.visible(
  jsonb_build_object('role', 'authenticated', 'channels', jsonb_build_array((select table1 from chan)))::text,
  (select salon1 from chan)), false, 'and not the salon channel of the staff');
select is(pg_temp.visible(
  jsonb_build_object('role', 'authenticated', 'channels', jsonb_build_array((select salon1 from chan)))::text,
  (select table1 from chan)), false, 'nor does a salon token hear a table channel');

select * from finish();
rollback;
