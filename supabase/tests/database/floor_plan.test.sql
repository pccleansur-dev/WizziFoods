begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(30);

insert into auth.users (id)
values
  ('b1000000-0000-4000-8000-000000000001'),
  ('b2000000-0000-4000-8000-000000000002');

insert into public.tenants (id, slug, name, status)
values
  ('b3000000-0000-4000-8000-000000000003', 'floor-one', 'Floor One', 'draft'),
  ('b4000000-0000-4000-8000-000000000004', 'floor-two', 'Floor Two', 'draft');

insert into public.tenant_memberships (tenant_id, user_id, role)
values
  ('b3000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000001', 'admin'),
  ('b4000000-0000-4000-8000-000000000004', 'b2000000-0000-4000-8000-000000000002', 'admin');

create temporary table scope as
select
  'b3000000-0000-4000-8000-000000000003'::uuid as t1,
  (select id from public.locations where tenant_id = 'b3000000-0000-4000-8000-000000000003') as l1,
  'b4000000-0000-4000-8000-000000000004'::uuid as t2,
  (select id from public.locations where tenant_id = 'b4000000-0000-4000-8000-000000000004') as l2;

create function pg_temp.save(expected integer, command uuid, plan jsonb)
returns table (applied boolean, result jsonb)
language sql as $$
  select * from private.save_floor_plan(
    (select t1 from scope), (select l1 from scope),
    'b1000000-0000-4000-8000-000000000001', command, expected, plan
  )
$$;

create function pg_temp.tbl(id text, label text, x integer, width integer, sector text default 'b5000000-0000-4000-8000-000000000005')
returns jsonb language sql as $$
  select jsonb_build_object(
    'id', id, 'label', label, 'sectorId', sector, 'shape', 'rectangle',
    'x', x, 'y', 40, 'width', width, 'height', 80, 'rotation', 0,
    'seatCount', 4, 'seatLayout', 'perimeter')
$$;

create temporary table plans (name text primary key, plan jsonb not null);
insert into plans values
('v1', jsonb_build_object(
  'sectors', jsonb_build_array(
    jsonb_build_object('id','b5000000-0000-4000-8000-000000000005','name','Salón','position',0),
    jsonb_build_object('id','b6000000-0000-4000-8000-000000000006','name','Terraza','position',1)),
  'tables', jsonb_build_array(
    pg_temp.tbl('c1000000-0000-4000-8000-000000000001','1',40,100),
    pg_temp.tbl('c2000000-0000-4000-8000-000000000002','2',200,100),
    pg_temp.tbl('c3000000-0000-4000-8000-000000000003','3',360,100,'b6000000-0000-4000-8000-000000000006')),
  'groups', '[]'::jsonb)),
('v2', jsonb_build_object(
  'sectors', jsonb_build_array(
    jsonb_build_object('id','b5000000-0000-4000-8000-000000000005','name','Salón','position',0),
    jsonb_build_object('id','b6000000-0000-4000-8000-000000000006','name','Terraza','position',1)),
  'tables', jsonb_build_array(
    pg_temp.tbl('c1000000-0000-4000-8000-000000000001','1',500,100),
    pg_temp.tbl('c2000000-0000-4000-8000-000000000002','2',200,160),
    pg_temp.tbl('c3000000-0000-4000-8000-000000000003','3',360,100,'b6000000-0000-4000-8000-000000000006')),
  'groups', jsonb_build_array(jsonb_build_object(
    'id','d1000000-0000-4000-8000-000000000001','name','Familia',
    'tableIds', jsonb_build_array('c2000000-0000-4000-8000-000000000002','c1000000-0000-4000-8000-000000000001')))));

select has_table('private', 'floor_table_qr_codes', 'QR codes are private rows');
select table_privs_are('private', 'floor_tables', 'authenticator', array[]::text[],
  'the runtime cannot touch floor tables directly');

create temporary table first_save as
select * from pg_temp.save(0, 'e1000000-0000-4000-8000-000000000001', (select plan from plans where name = 'v1'));

select results_eq($$ select applied, (result->>'version')::int from first_save $$,
  $$ values (true, 1) $$, 'the first command creates version 1');
select is((select result->'plan' from first_save), (select plan from plans where name = 'v1'),
  'the stored plan restores exactly as saved');
select results_eq(
  $$ select count(*)::int, count(distinct token)::int, bool_and(token ~ '^[0-9a-f]{64}$')
     from private.list_floor_table_qr_codes((select t1 from scope), (select l1 from scope), 'b1000000-0000-4000-8000-000000000001') $$,
  $$ values (3, 3, true) $$, 'every table gets a unique opaque 256-bit token');

create temporary table tokens_before as
select table_id, token from private.list_floor_table_qr_codes((select t1 from scope), (select l1 from scope), 'b1000000-0000-4000-8000-000000000001');

create temporary table second_save as
select * from pg_temp.save(1, 'e2000000-0000-4000-8000-000000000002', (select plan from plans where name = 'v2'));

select is((select result->'plan' from second_save), (select plan from plans where name = 'v2'),
  'moving, resizing and grouping restores the exact plan');
select results_eq(
  $$ select table_id, token from private.list_floor_table_qr_codes((select t1 from scope), (select l1 from scope), 'b1000000-0000-4000-8000-000000000001') order by 1 $$,
  $$ select table_id, token from tokens_before order by 1 $$,
  'move, resize and group keep table ids and QR tokens');
select results_eq(
  $$ select x from private.floor_table_geometry where table_id = 'c1000000-0000-4000-8000-000000000001' $$,
  $$ values (500) $$, 'geometry changed independently of identity');

select results_eq($$ select applied from pg_temp.save(1, 'e2000000-0000-4000-8000-000000000002', (select plan from plans where name = 'v2')) $$,
  $$ values (false) $$, 'replaying the same command is a no-op');
select results_eq($$ select version from private.floor_plans where tenant_id = (select t1 from scope) $$,
  $$ values (2) $$, 'a replay does not bump the version');
select throws_ok(
  $$ select * from pg_temp.save(1, 'e2000000-0000-4000-8000-000000000002', (select plan from plans where name = 'v1')) $$,
  '23505', null, 'a command id cannot be reused with another payload');
select throws_ok(
  $$ select * from pg_temp.save(0, 'e3000000-0000-4000-8000-000000000003', (select plan from plans where name = 'v1')) $$,
  '40001', null, 'a stale version is rejected instead of overwriting');

create temporary table ungroup_save as
select * from pg_temp.save(2, 'e4000000-0000-4000-8000-000000000004',
  jsonb_set((select plan from plans where name = 'v2'), '{groups}', '[]'));
select results_eq($$ select jsonb_array_length(result->'plan'->'groups') from ungroup_save $$,
  $$ values (0) $$, 'ungrouping removes only the membership');
select results_eq(
  $$ select table_id, token from private.list_floor_table_qr_codes((select t1 from scope), (select l1 from scope), 'b1000000-0000-4000-8000-000000000001') order by 1 $$,
  $$ select table_id, token from tokens_before order by 1 $$,
  'ungrouping keeps ids and QR tokens');

select lives_ok(
  $$ select * from pg_temp.save(3, 'e5000000-0000-4000-8000-000000000005', jsonb_set(
       jsonb_set((select plan from plans where name = 'v2'), '{groups}', '[]'),
       '{tables}', jsonb_build_array(
         pg_temp.tbl('c1000000-0000-4000-8000-000000000001','2',500,100),
         pg_temp.tbl('c2000000-0000-4000-8000-000000000002','1',200,160),
         pg_temp.tbl('c3000000-0000-4000-8000-000000000003','3',360,100,'b6000000-0000-4000-8000-000000000006')))) $$,
  'two tables can swap labels in one command');
select throws_ok(
  $$ select * from pg_temp.save(4, 'e6000000-0000-4000-8000-000000000006', jsonb_set(
       (select plan from plans where name = 'v1'), '{tables,1,label}', '"3"')) $$,
  '23P01', null, 'duplicate labels are rejected by the database');
select throws_ok(
  $$ select * from pg_temp.save(4, 'e7000000-0000-4000-8000-000000000007', jsonb_set(
       (select plan from plans where name = 'v1'), '{tables,0,x}', '-1')) $$,
  '23514', null, 'geometry outside the canvas is rejected by constraints');
select throws_ok(
  $$ select * from pg_temp.save(4, 'e8000000-0000-4000-8000-000000000008', jsonb_set(
       (select plan from plans where name = 'v1'), '{tables,0,tenantId}', '"x"')) $$,
  '22023', null, 'unknown keys are rejected');
select throws_ok(
  $$ select * from pg_temp.save(4, 'e9000000-0000-4000-8000-000000000009', jsonb_set(
       (select plan from plans where name = 'v1'), '{groups}', jsonb_build_array(
         jsonb_build_object('id','d1000000-0000-4000-8000-000000000001','name','A','tableIds',
           jsonb_build_array('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000002')),
         jsonb_build_object('id','d2000000-0000-4000-8000-000000000002','name','B','tableIds',
           jsonb_build_array('c2000000-0000-4000-8000-000000000002','c3000000-0000-4000-8000-000000000003'))))) $$,
  '23505', null, 'a table cannot belong to two groups');
select throws_ok(
  $$ select * from private.save_floor_plan((select t1 from scope), (select l1 from scope),
       'b2000000-0000-4000-8000-000000000002', 'ea000000-0000-4000-8000-00000000000a', 4,
       (select plan from plans where name = 'v1')) $$,
  '42501', null, 'an admin of another tenant cannot edit this floor plan');
select throws_ok(
  $$ select * from private.save_floor_plan((select t1 from scope), (select l2 from scope),
       'b1000000-0000-4000-8000-000000000001', 'eb000000-0000-4000-8000-00000000000b', 0,
       (select plan from plans where name = 'v1')) $$,
  '42501', null, 'a location from another tenant is refused');

create temporary table t3_token as
select token from private.list_floor_table_qr_codes((select t1 from scope), (select l1 from scope), 'b1000000-0000-4000-8000-000000000001')
where table_id = 'c3000000-0000-4000-8000-000000000003';

select results_eq(
  $$ select label from private.resolve_floor_table_qr((select t1 from scope), (select l1 from scope), (select token from t3_token)) $$,
  $$ values ('3') $$, 'a token resolves inside its own tenant');
select is_empty(
  $$ select * from private.resolve_floor_table_qr((select t2 from scope), (select l2 from scope), (select token from t3_token)) $$,
  'the same token resolves to nothing for another tenant');

select lives_ok(
  $$ select * from pg_temp.save(4, 'ec000000-0000-4000-8000-00000000000c', jsonb_set(
       jsonb_set((select plan from plans where name = 'v2'), '{groups}', '[]'),
       '{tables}', jsonb_build_array(
         pg_temp.tbl('c1000000-0000-4000-8000-000000000001','2',500,100),
         pg_temp.tbl('c2000000-0000-4000-8000-000000000002','1',200,160)))) $$,
  'removing a table retires it');
select is_empty(
  $$ select * from private.resolve_floor_table_qr((select t1 from scope), (select l1 from scope), (select token from t3_token)) $$,
  'a retired table QR stops resolving');
select throws_ok(
  $$ select * from pg_temp.save(5, 'ed000000-0000-4000-8000-00000000000d', (select plan from plans where name = 'v1')) $$,
  '23505', null, 'a retired table id cannot be restored');

create temporary table t1_old as
select token from private.list_floor_table_qr_codes((select t1 from scope), (select l1 from scope), 'b1000000-0000-4000-8000-000000000001')
where table_id = 'c1000000-0000-4000-8000-000000000001';
select private.rotate_floor_table_qr((select t1 from scope), (select l1 from scope),
  'b1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001');
select is_empty(
  $$ select * from private.resolve_floor_table_qr((select t1 from scope), (select l1 from scope), (select token from t1_old)) $$,
  'a rotated QR no longer resolves');
select results_eq(
  $$ select active_tables, tables_with_qr from private.floor_plan_readiness((select t1 from scope), (select l1 from scope)) $$,
  $$ values (2, 2) $$, 'readiness counts active tables with a valid QR');
select throws_ok(
  $$ update private.floor_table_qr_codes set token = repeat('a', 64) where status = 'active' $$,
  '23514', null, 'QR tokens are immutable');

select is_empty(
  $$ select * from private.floor_tables where tenant_id = (select t2 from scope) $$,
  'the second tenant owns no tables');

select * from finish();
rollback;
