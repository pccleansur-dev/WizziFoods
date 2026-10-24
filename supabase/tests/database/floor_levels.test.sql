begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(17);

insert into auth.users (id)
values
  ('c1000000-0000-4000-8000-000000000001'),
  ('c2000000-0000-4000-8000-000000000002');

insert into public.tenants (id, slug, name, status)
values
  ('c3000000-0000-4000-8000-000000000003', 'lvl-one', 'Levels One', 'draft'),
  ('c4000000-0000-4000-8000-000000000004', 'lvl-two', 'Levels Two', 'draft');

insert into public.tenant_memberships (tenant_id, user_id, role)
values
  ('c3000000-0000-4000-8000-000000000003', 'c1000000-0000-4000-8000-000000000001', 'admin'),
  ('c4000000-0000-4000-8000-000000000004', 'c2000000-0000-4000-8000-000000000002', 'admin');

create temporary table scope as
select
  'c3000000-0000-4000-8000-000000000003'::uuid as t1,
  (select id from public.locations where tenant_id = 'c3000000-0000-4000-8000-000000000003') as l1,
  'c4000000-0000-4000-8000-000000000004'::uuid as t2,
  (select id from public.locations where tenant_id = 'c4000000-0000-4000-8000-000000000004') as l2;

-- ids: floors c7/c8, sector c5, tables d1/d2/d3
create function pg_temp.tbl(id text, label text, floor text, x integer)
returns jsonb language sql as $$
  select jsonb_build_object(
    'id', id, 'label', label, 'sectorId', 'c5000000-0000-4000-8000-000000000005',
    'floorId', floor, 'shape', 'rectangle', 'x', x, 'y', 40, 'width', 100,
    'height', 80, 'rotation', 0, 'seatCount', 4, 'seatLayout', 'perimeter')
$$;

create function pg_temp.floor_json(floor_id text, floor_name text, floor_position integer, short text default null)
returns jsonb language sql as $$
  select jsonb_build_object('id', floor_id, 'name', floor_name, 'position', floor_position, 'shortName', short)
$$;

create function pg_temp.plan(floors jsonb, tables jsonb, groups jsonb default '[]'::jsonb)
returns jsonb language sql as $$
  select jsonb_build_object(
    'floors', floors,
    'sectors', jsonb_build_array(jsonb_build_object('id', 'c5000000-0000-4000-8000-000000000005', 'name', 'Salón', 'position', 0)),
    'tables', tables,
    'groups', groups)
$$;

create function pg_temp.save(expected integer, command text, plan jsonb)
returns table (applied boolean, result jsonb)
language sql as $$
  select * from private.save_floor_plan(
    (select t1 from scope), (select l1 from scope),
    'c1000000-0000-4000-8000-000000000001', command::uuid, expected, plan)
$$;

create temporary table two_floors as
select pg_temp.floor_json('c7000000-0000-4000-8000-000000000007', 'Planta baja', 0, 'PB') as pb,
       pg_temp.floor_json('c8000000-0000-4000-8000-000000000008', 'Planta alta', 1) as pa;

-- 1. Two floors with tables on each.
create temporary table first_save as
select * from pg_temp.save(0, 'c9000000-0000-4000-8000-000000000001', pg_temp.plan(
  (select jsonb_build_array(pb, pa) from two_floors),
  jsonb_build_array(
    pg_temp.tbl('d1000000-0000-4000-8000-000000000001', '1', 'c7000000-0000-4000-8000-000000000007', 40),
    pg_temp.tbl('d2000000-0000-4000-8000-000000000002', '2', 'c7000000-0000-4000-8000-000000000007', 200),
    pg_temp.tbl('d3000000-0000-4000-8000-000000000003', '3', 'c8000000-0000-4000-8000-000000000008', 40))));

select is((select jsonb_array_length(result -> 'plan' -> 'floors') from first_save), 2,
  'a plan stores several floors');
select is((select result -> 'plan' -> 'floors' -> 0 ->> 'shortName' from first_save), 'PB',
  'the short name is kept');
select is((select result -> 'plan' -> 'floors' -> 1 -> 'shortName' from first_save), 'null'::jsonb,
  'the short name is optional');
select is((select count(*)::int from jsonb_array_elements((select result from first_save) -> 'plan' -> 'tables') t
  where t ->> 'floorId' = 'c8000000-0000-4000-8000-000000000008'), 1,
  'each table reports its own floor');

-- 2. Moving a table to another floor keeps its identity and its QR.
create temporary table qr_before as
select token from private.floor_table_qr_codes
where table_id = 'd1000000-0000-4000-8000-000000000001' and status = 'active';

select lives_ok($$ select * from pg_temp.save(1, 'c9000000-0000-4000-8000-000000000002', pg_temp.plan(
  (select jsonb_build_array(pb, pa) from two_floors),
  jsonb_build_array(
    pg_temp.tbl('d1000000-0000-4000-8000-000000000001', '1', 'c8000000-0000-4000-8000-000000000008', 40),
    pg_temp.tbl('d2000000-0000-4000-8000-000000000002', '2', 'c7000000-0000-4000-8000-000000000007', 200),
    pg_temp.tbl('d3000000-0000-4000-8000-000000000003', '3', 'c8000000-0000-4000-8000-000000000008', 200)))) $$,
  'a table can move to another floor');
select is((select level_id from private.floor_tables where id = 'd1000000-0000-4000-8000-000000000001'),
  'c8000000-0000-4000-8000-000000000008'::uuid, 'the move is stored');
select is((select token from private.floor_table_qr_codes
  where table_id = 'd1000000-0000-4000-8000-000000000001' and status = 'active'),
  (select token from qr_before), 'the QR does not change when the table changes floor');

-- 3. Referential rules.
select throws_ok($$ select * from pg_temp.save(2, 'c9000000-0000-4000-8000-000000000003', pg_temp.plan(
  (select jsonb_build_array(pb) from two_floors),
  jsonb_build_array(pg_temp.tbl('d1000000-0000-4000-8000-000000000001', '1', 'c8000000-0000-4000-8000-000000000008', 40)))) $$,
  '22023', null, 'a table cannot point at a floor missing from the plan');
select throws_ok($$ select * from pg_temp.save(2, 'c9000000-0000-4000-8000-000000000004', pg_temp.plan(
  (select jsonb_build_array(pb, pa) from two_floors),
  jsonb_build_array(
    pg_temp.tbl('d1000000-0000-4000-8000-000000000001', '1', 'c8000000-0000-4000-8000-000000000008', 40),
    pg_temp.tbl('d2000000-0000-4000-8000-000000000002', '2', 'c7000000-0000-4000-8000-000000000007', 200)),
  jsonb_build_array(jsonb_build_object('id', 'ca000000-0000-4000-8000-00000000000a', 'name', 'Mixta',
    'tableIds', jsonb_build_array('d1000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000002'))))) $$,
  '22023', null, 'a group cannot span two floors');
select throws_ok($$ select * from pg_temp.save(2, 'c9000000-0000-4000-8000-000000000005', pg_temp.plan(
  jsonb_build_array(
    pg_temp.floor_json('c7000000-0000-4000-8000-000000000007', 'Piso', 0),
    pg_temp.floor_json('c8000000-0000-4000-8000-000000000008', 'PISO', 1)),
  '[]'::jsonb)) $$,
  '23P01', null, 'floor names are unique ignoring case');
select throws_ok($$ select * from pg_temp.save(2, 'c9000000-0000-4000-8000-000000000006', pg_temp.plan(
  jsonb_build_array(pg_temp.floor_json('c7000000-0000-4000-8000-000000000007', 'Planta baja', 0, 'demasiado largo'),
                    (select pa from two_floors)),
  '[]'::jsonb)) $$,
  '23514', null, 'the short name is limited to 10 characters');

-- 4. Names can be swapped in one save; empty floors can be removed.
select lives_ok($$ select * from pg_temp.save(2, 'c9000000-0000-4000-8000-000000000007', pg_temp.plan(
  jsonb_build_array(
    pg_temp.floor_json('c7000000-0000-4000-8000-000000000007', 'Planta alta', 0),
    pg_temp.floor_json('c8000000-0000-4000-8000-000000000008', 'Planta baja', 1)),
  jsonb_build_array(
    pg_temp.tbl('d1000000-0000-4000-8000-000000000001', '1', 'c8000000-0000-4000-8000-000000000008', 40)))) $$,
  'two floors can swap names inside one save');
select is((select count(*)::int from private.floor_tables
  where tenant_id = (select t1 from scope) and retired_at is null and level_id is null), 0,
  'every active table keeps a floor');
select is((select count(*)::int from private.floor_tables
  where tenant_id = (select t1 from scope) and retired_at is not null and level_id is not null), 0,
  'a retired table has no floor');

-- 5. Isolation and privileges.
select is((select jsonb_array_length(private.get_floor_plan((select t2 from scope), (select l2 from scope),
  'c2000000-0000-4000-8000-000000000002') -> 'plan' -> 'floors')), 0,
  'the other tenant sees none of these floors');
select throws_ok($$ select private.get_floor_plan((select t1 from scope), (select l1 from scope),
  'c2000000-0000-4000-8000-000000000002') $$, '42501', null,
  'an administrator of another tenant cannot read these floors');
select table_privs_are('private', 'floor_levels', 'authenticator', array[]::text[],
  'the runtime reads floors only through functions');

select * from finish();
rollback;
