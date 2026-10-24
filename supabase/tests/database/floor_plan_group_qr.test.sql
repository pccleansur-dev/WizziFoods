begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(7);

insert into auth.users (id) values ('a1000000-0000-4000-8000-000000000001');
insert into public.tenants (id, slug, name, status)
values
  ('a3000000-0000-4000-8000-000000000003', 'group-qr-one', 'Group QR One', 'draft'),
  ('a4000000-0000-4000-8000-000000000004', 'group-qr-two', 'Group QR Two', 'draft');
insert into public.tenant_memberships (tenant_id, user_id, role)
values ('a3000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'admin');

create temporary table scope as
select
  'a3000000-0000-4000-8000-000000000003'::uuid as t1,
  (select id from public.locations where tenant_id = 'a3000000-0000-4000-8000-000000000003') as l1,
  'a4000000-0000-4000-8000-000000000004'::uuid as t2,
  (select id from public.locations where tenant_id = 'a4000000-0000-4000-8000-000000000004') as l2;

create function pg_temp.save(expected integer, command uuid, plan jsonb)
returns table (applied boolean, result jsonb)
language sql as $$
  select * from private.save_floor_plan(
    (select t1 from scope), (select l1 from scope),
    'a1000000-0000-4000-8000-000000000001', command, expected, plan)
$$;

create function pg_temp.tbl(id text, label text, x integer)
returns jsonb language sql as $$
  select jsonb_build_object(
    'id', id, 'label', label, 'sectorId', 'a6000000-0000-4000-8000-000000000006',
    'floorId', 'a7000000-0000-4000-8000-000000000007', 'shape', 'rectangle',
    'x', x, 'y', 40, 'width', 100, 'height', 80, 'rotation', 0,
    'seatCount', 4, 'seatLayout', 'perimeter')
$$;

create function pg_temp.plan_with(groups jsonb, tables jsonb)
returns jsonb language sql as $$
  select jsonb_build_object(
    'floors', jsonb_build_array(jsonb_build_object('id','a7000000-0000-4000-8000-000000000007','name','Planta baja','position',0,'shortName',null)),
    'sectors', jsonb_build_array(jsonb_build_object('id','a6000000-0000-4000-8000-000000000006','name','Salón','position',0)),
    'tables', tables,
    'groups', groups)
$$;

select pg_temp.save(0, 'a9000000-0000-4000-8000-000000000001', pg_temp.plan_with('[]'::jsonb,
  jsonb_build_array(
    pg_temp.tbl('a5000000-0000-4000-8000-000000000001','18',40),
    pg_temp.tbl('a5000000-0000-4000-8000-000000000002','17',200),
    pg_temp.tbl('a5000000-0000-4000-8000-000000000003','5',360))));

create temporary table tokens as
select table_id, token
from private.list_floor_table_qr_codes((select t1 from scope), (select l1 from scope), 'a1000000-0000-4000-8000-000000000001');

select results_eq(
  $$ select group_id, group_name, group_table_labels
     from private.resolve_floor_table_qr((select t1 from scope), (select l1 from scope),
       (select token from tokens where table_id = 'a5000000-0000-4000-8000-000000000001')) $$,
  $$ values (null::uuid, null::text, null::text[]) $$,
  'an ungrouped table resolves without a group');

select pg_temp.save(1, 'a9000000-0000-4000-8000-000000000002', pg_temp.plan_with(
  jsonb_build_array(jsonb_build_object('id','a8000000-0000-4000-8000-000000000008','name','Cumpleaños','tableIds',
    jsonb_build_array('a5000000-0000-4000-8000-000000000001','a5000000-0000-4000-8000-000000000002'))),
  jsonb_build_array(
    pg_temp.tbl('a5000000-0000-4000-8000-000000000001','18',40),
    pg_temp.tbl('a5000000-0000-4000-8000-000000000002','17',200),
    pg_temp.tbl('a5000000-0000-4000-8000-000000000003','5',360))));

select results_eq(
  $$ select table_id, label, group_id, group_name, group_table_labels
     from private.resolve_floor_table_qr((select t1 from scope), (select l1 from scope),
       (select token from tokens where table_id = 'a5000000-0000-4000-8000-000000000001')) $$,
  $$ values ('a5000000-0000-4000-8000-000000000001'::uuid, '18', 'a8000000-0000-4000-8000-000000000008'::uuid, 'Cumpleaños', array['17','18']) $$,
  'a grouped table resolves with its group and every table label');
select results_eq(
  $$ select group_id, group_table_labels
     from private.resolve_floor_table_qr((select t1 from scope), (select l1 from scope),
       (select token from tokens where table_id = 'a5000000-0000-4000-8000-000000000002')) $$,
  $$ values ('a8000000-0000-4000-8000-000000000008'::uuid, array['17','18']) $$,
  'the other table of the group resolves to the same group');
select results_eq(
  $$ select table_id, token from private.list_floor_table_qr_codes((select t1 from scope), (select l1 from scope), 'a1000000-0000-4000-8000-000000000001') order by 1 $$,
  $$ select table_id, token from tokens order by 1 $$,
  'grouping keeps the QR tokens');
select is_empty(
  $$ select * from private.resolve_floor_table_qr((select t2 from scope), (select l2 from scope),
       (select token from tokens where table_id = 'a5000000-0000-4000-8000-000000000001')) $$,
  'the group does not leak to another tenant');

select pg_temp.save(2, 'a9000000-0000-4000-8000-000000000003', pg_temp.plan_with('[]'::jsonb,
  jsonb_build_array(
    pg_temp.tbl('a5000000-0000-4000-8000-000000000001','18',40),
    pg_temp.tbl('a5000000-0000-4000-8000-000000000002','17',200))));
select results_eq(
  $$ select label, group_id from private.resolve_floor_table_qr((select t1 from scope), (select l1 from scope),
       (select token from tokens where table_id = 'a5000000-0000-4000-8000-000000000001')) $$,
  $$ values ('18', null::uuid) $$,
  'ungrouping (and retiring a table) leaves the QR standing alone');
select is_empty(
  $$ select * from private.resolve_floor_table_qr((select t1 from scope), (select l1 from scope),
       (select token from tokens where table_id = 'a5000000-0000-4000-8000-000000000003')) $$,
  'a retired table still stops resolving');

select * from finish();
rollback;
