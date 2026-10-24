begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(11);

insert into auth.users (id) values ('b1000000-0000-4000-8000-000000000001');
insert into public.platform_superadmins (user_id) values ('b1000000-0000-4000-8000-000000000001');
insert into public.tenants (id, slug, name, status)
values
  ('b3000000-0000-4000-8000-000000000003', 'entry-one', 'Entry One', 'active'),
  ('b4000000-0000-4000-8000-000000000004', 'entry-two', 'Entry Two', 'active');
insert into public.tenant_memberships (tenant_id, user_id, role)
values ('b3000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000001', 'admin');

create temporary table scope as
select
  'b3000000-0000-4000-8000-000000000003'::uuid as t1,
  (select id from public.locations where tenant_id = 'b3000000-0000-4000-8000-000000000003') as l1,
  'b4000000-0000-4000-8000-000000000004'::uuid as t2,
  (select id from public.locations where tenant_id = 'b4000000-0000-4000-8000-000000000004') as l2;

create function pg_temp.tbl(id text, label text, x integer)
returns jsonb language sql as $$
  select jsonb_build_object(
    'id', id, 'label', label, 'sectorId', 'b6000000-0000-4000-8000-000000000006',
    'floorId', 'b7000000-0000-4000-8000-000000000007', 'shape', 'rectangle',
    'x', x, 'y', 40, 'width', 100, 'height', 80, 'rotation', 0,
    'seatCount', 4, 'seatLayout', 'perimeter')
$$;

create function pg_temp.plan_with(groups jsonb, tables jsonb)
returns jsonb language sql as $$
  select jsonb_build_object(
    'floors', jsonb_build_array(jsonb_build_object('id','b7000000-0000-4000-8000-000000000007','name','Terraza','position',0,'shortName',null)),
    'sectors', jsonb_build_array(jsonb_build_object('id','b6000000-0000-4000-8000-000000000006','name','Salón','position',0)),
    'tables', tables,
    'groups', groups)
$$;

select private.save_floor_plan(
  (select t1 from scope), (select l1 from scope),
  'b1000000-0000-4000-8000-000000000001', 'b9000000-0000-4000-8000-000000000001', 0,
  pg_temp.plan_with(
    jsonb_build_array(jsonb_build_object('id','b8000000-0000-4000-8000-000000000008','name','Cumpleaños','tableIds',
      jsonb_build_array('b5000000-0000-4000-8000-000000000001','b5000000-0000-4000-8000-000000000002'))),
    jsonb_build_array(
      pg_temp.tbl('b5000000-0000-4000-8000-000000000001','18',40),
      pg_temp.tbl('b5000000-0000-4000-8000-000000000002','17',200),
      pg_temp.tbl('b5000000-0000-4000-8000-000000000003','5',360))));

create temporary table tokens as
select table_id, token
from private.list_floor_table_qr_codes((select t1 from scope), (select l1 from scope), 'b1000000-0000-4000-8000-000000000001');

create function pg_temp.entry(table_uuid text)
returns table (service_state text, published boolean, accepts_new_tables boolean, floor_name text, group_name text)
language sql as $$
  select e.service_state, e.published, e.accepts_new_tables, e.floor_name, e.group_name
  from private.resolve_table_entry((select t1 from scope), (select l1 from scope),
    (select token from tokens where table_id = table_uuid::uuid)) e
$$;

create function pg_temp.set_state(table_uuid text, new_state text)
returns void language sql as $$
  insert into private.floor_table_service_states (tenant_id, location_id, table_id, state)
  values ((select t1 from scope), (select l1 from scope), table_uuid::uuid, new_state)
  on conflict (tenant_id, location_id, table_id) do update set state = excluded.state
$$;

select results_eq(
  $$ select * from pg_temp.entry('b5000000-0000-4000-8000-000000000003') $$,
  $$ values ('available', false, true, 'Terraza', null::text) $$,
  'a table without a state is available, shows its floor and an unpublished location is flagged');

insert into private.location_publications (tenant_id, location_id, published_by)
values ((select t1 from scope), (select l1 from scope), 'b1000000-0000-4000-8000-000000000001');
select is((select published from pg_temp.entry('b5000000-0000-4000-8000-000000000003')), true,
  'a published location is flagged as published');

select pg_temp.set_state('b5000000-0000-4000-8000-000000000003', 'occupied');
select is((select service_state from pg_temp.entry('b5000000-0000-4000-8000-000000000003')), 'occupied', 'an occupied table reports occupied');
select pg_temp.set_state('b5000000-0000-4000-8000-000000000003', 'needs_cleaning');
select is((select service_state from pg_temp.entry('b5000000-0000-4000-8000-000000000003')), 'needs_cleaning', 'a table pending cleaning reports it');
select pg_temp.set_state('b5000000-0000-4000-8000-000000000003', 'out_of_service');
select is((select service_state from pg_temp.entry('b5000000-0000-4000-8000-000000000003')), 'out_of_service', 'an out of service table reports it');
select throws_ok(
  $$ select pg_temp.set_state('b5000000-0000-4000-8000-000000000001', 'busy') $$,
  '23514', null, 'an unknown state is rejected');

select pg_temp.set_state('b5000000-0000-4000-8000-000000000002', 'occupied');
select results_eq(
  $$ select service_state, group_name from pg_temp.entry('b5000000-0000-4000-8000-000000000001') $$,
  $$ values ('occupied', 'Cumpleaños') $$,
  'the free table of a group is occupied when its mate is occupied');

select pg_temp.set_state('b5000000-0000-4000-8000-000000000001', 'needs_cleaning');
select is((select service_state from pg_temp.entry('b5000000-0000-4000-8000-000000000001')), 'needs_cleaning',
  'a grouped table that cannot be used keeps its own state');

insert into private.tenant_suspensions (tenant_id, mode, phase, reason, requested_by, correlation_id)
values ((select t1 from scope), 'commercial', 'commercial_draining', 'test reason',
  'b1000000-0000-4000-8000-000000000001', 'corr-1');
select is((select accepts_new_tables from pg_temp.entry('b5000000-0000-4000-8000-000000000003')), false,
  'a business that is draining stops accepting new tables');

select is_empty(
  $$ select * from private.resolve_table_entry((select t2 from scope), (select l2 from scope),
       (select token from tokens where table_id = 'b5000000-0000-4000-8000-000000000003')) $$,
  'a token of another tenant does not resolve');
select is_empty(
  $$ select * from private.resolve_table_entry((select t1 from scope), (select l1 from scope), repeat('0', 64))
     union all
     select * from private.resolve_table_entry((select t1 from scope), (select l1 from scope), 'not-a-token') $$,
  'unknown and malformed tokens do not resolve');

select * from finish();
rollback;
