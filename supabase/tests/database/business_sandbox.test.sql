begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(26);

insert into auth.users (id)
values
  ('e1000000-0000-4000-8000-000000000001'),
  ('e2000000-0000-4000-8000-000000000002');

insert into public.tenants (id, slug, name, status)
values
  ('e3000000-0000-4000-8000-000000000003', 'sbx-one', 'Sandbox One', 'draft'),
  ('e4000000-0000-4000-8000-000000000004', 'sbx-two', 'Sandbox Two', 'draft');

insert into public.tenant_memberships (tenant_id, user_id, role)
values
  ('e3000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-000000000001', 'admin'),
  ('e4000000-0000-4000-8000-000000000004', 'e2000000-0000-4000-8000-000000000002', 'admin');

create temporary table scope as
select
  'e3000000-0000-4000-8000-000000000003'::uuid as t1,
  (select id from public.locations where tenant_id = 'e3000000-0000-4000-8000-000000000003') as l1,
  'e4000000-0000-4000-8000-000000000004'::uuid as t2,
  (select id from public.locations where tenant_id = 'e4000000-0000-4000-8000-000000000004') as l2;

create function pg_temp.run(which integer default 1)
returns jsonb language sql as $$
  select case which
    when 1 then private.run_sandbox_simulation((select t1 from scope), (select l1 from scope), 'e1000000-0000-4000-8000-000000000001')
    else private.run_sandbox_simulation((select t2 from scope), (select l2 from scope), 'e2000000-0000-4000-8000-000000000002')
  end
$$;

-- A snapshot of everything real operation reads, to prove the simulation is inert.
create function pg_temp.real_state()
returns text language sql as $$
  select md5(concat_ws('|',
    (select coalesce(string_agg(m::text, ',' order by method_key), '') from private.payment_methods m),
    (select count(*)::text from private.payment_method_secrets),
    (select coalesce(string_agg(t::text, ',' order by id), '') from private.floor_tables t),
    (select coalesce(string_agg(q::text, ',' order by id), '') from private.floor_table_qr_codes q),
    (select coalesce(string_agg(p::text, ',' order by id), '') from private.published_catalogs p),
    (select count(*)::text from private.location_publications),
    (select count(*)::text from public.staff_members),
    (select coalesce(string_agg(x::text, ',' order by id), '') from public.tenants x)
  ))
$$;

-- No prerequisites yet: the simulation explains what is missing.
select throws_ok($$ select pg_temp.run() $$, 'PT102', null,
  'the simulation needs a table with a QR and a published catalog');

-- Fixture: profile, published catalog, one table with a QR.
do $fixture$ begin
perform private.save_business_profile_draft(
  (select t1 from scope), (select l1 from scope), 'e1000000-0000-4000-8000-000000000001',
  'Bar Uno', '', '+54 11 5555 0000', '', '', array['es'], 'visual', 'serif',
  '#1F2937', '#F9FAFB', '#D97706', null, null, '{}'::uuid[]);
end $fixture$;

do $fixture$ begin
perform private.save_catalog_draft(
  (select t1 from scope), (select l1 from scope), 'e1000000-0000-4000-8000-000000000001',
  '{
    "baseRevision": null,
    "categories": [{"id":"e5000000-0000-4000-8000-000000000005","position":0,"content":[{"language":"es","title":"Principales","description":""}]}],
    "sectors": [{"id":"e6000000-0000-4000-8000-000000000006","position":0,"kind":"kitchen","name":"Cocina"}],
    "products": [{"id":"e7000000-0000-4000-8000-000000000007","categoryId":"e5000000-0000-4000-8000-000000000005","sectorId":"e6000000-0000-4000-8000-000000000006","position":0,"priceCents":125000,"imageAssetId":null,"content":[{"language":"es","title":"Milanesa","description":"Con papas"}],"variants":[]}]
  }'::jsonb);
end $fixture$;

do $fixture$ begin
perform private.publish_catalog((select t1 from scope), (select l1 from scope),
  'e1000000-0000-4000-8000-000000000001', 1);
end $fixture$;

do $fixture$ begin
perform private.save_floor_plan(
  (select t1 from scope), (select l1 from scope), 'e1000000-0000-4000-8000-000000000001',
  'e9000000-0000-4000-8000-000000000009', 0,
  jsonb_build_object(
    'sectors', jsonb_build_array(jsonb_build_object('id','ea000000-0000-4000-8000-00000000000a','name','Salón','position',0)),
    'tables', jsonb_build_array(jsonb_build_object(
      'id','eb000000-0000-4000-8000-00000000000b','label','1','sectorId','ea000000-0000-4000-8000-00000000000a',
      'shape','rectangle','x',40,'y',40,'width',100,'height',80,'rotation',0,'seatCount',4,'seatLayout','perimeter')),
    'groups', '[]'::jsonb));
end $fixture$;

do $fixture$ begin
perform private.update_payment_method((select t1 from scope), (select l1 from scope),
  'e1000000-0000-4000-8000-000000000001', 'debit_card', true, null);
end $fixture$;

create temporary table before_state as
select
  pg_temp.real_state() as hash,
  (select count(*)::int from private.audit_events
    where tenant_id = (select t1 from scope) and action not like 'sandbox.%') as real_events;
create temporary table the_run as select pg_temp.run() as run;

-- The circuit.
select is((select run ->> 'namespace' from the_run), 'sandbox', 'the run lives in the sandbox namespace');
select ok((select run ->> 'reference' from the_run) ~ '^SBX-[0-9A-Z]{8}$', 'its reference is explicitly marked');
select is((select string_agg(s ->> 'step', ',') from the_run, jsonb_array_elements(run -> 'steps') s),
  'qr_scanned,order_placed,in_production,payment_recorded,closed,cleaned_up',
  'it walks QR, order, production, payment, close and cleanup in order');
select ok((select bool_and((s ->> 'ok')::boolean) from the_run, jsonb_array_elements(run -> 'steps') s),
  'every step succeeded');

-- Cleanup and isolation.
select is((select count(*)::int from private.sandbox_orders where tenant_id = (select t1 from scope)), 0,
  'cleanup removes every simulated order');
select isnt((select cleaned_at from private.sandbox_runs limit 1), null, 'the run records its cleanup');
select is((select pg_temp.real_state()), (select hash from before_state),
  'payment methods, credentials, tables, QR, catalog, staff and tenants are untouched');
select is((select count(*)::int from private.audit_events
  where tenant_id = (select t1 from scope) and action like 'sandbox.%'), 1,
  'the run leaves one audit event in the sandbox action namespace');
select is((select count(*)::int from private.audit_events
  where tenant_id = (select t1 from scope) and action not like 'sandbox.%'),
  (select real_events from before_state),
  'the simulation emits no real operation events');
select is((select count(*)::int from private.location_publications), 0,
  'simulating never publishes the business');

-- Structure: nothing real can point at the sandbox, and the runtime cannot touch it.
select is((select count(*)::int
  from pg_constraint c
  where c.contype = 'f'
    and c.confrelid in ('private.sandbox_runs'::regclass, 'private.sandbox_orders'::regclass)
    and c.conrelid not in ('private.sandbox_steps'::regclass, 'private.sandbox_orders'::regclass)), 0,
  'no production table references the sandbox');
select table_privs_are('private', 'sandbox_orders', 'authenticator', array[]::text[],
  'the runtime reads the sandbox only through functions');
select ok(not exists (
  select 1 from information_schema.columns
  where table_schema = 'private' and table_name in ('sandbox_orders', 'sandbox_runs', 'sandbox_steps')
    and column_name ~* 'token|secret|credential|pin'), 'sandbox tables hold no secrets');
select throws_ok($$ update private.sandbox_runs set namespace = 'production' $$, '23514', null,
  'a run cannot leave the sandbox namespace');
select throws_ok($$
  insert into private.sandbox_orders (run_id, tenant_id, location_id, reference, table_id, status, items, total_cents, paid_cents)
  select id, tenant_id, location_id, 'SBX-ZZZZZZZZ', 'eb000000-0000-4000-8000-00000000000b', 'closed', '[]'::jsonb, 100, 0
  from private.sandbox_runs limit 1
$$, '23514', null, 'an order cannot close without being fully paid');

-- Authorization and tenant isolation.
select throws_ok($$ select private.run_sandbox_simulation((select t1 from scope), (select l1 from scope),
  'e2000000-0000-4000-8000-000000000002') $$, '42501', null,
  'an administrator of another tenant cannot simulate here');
select throws_ok($$ select private.cleanup_sandbox((select t1 from scope), (select l1 from scope),
  'e2000000-0000-4000-8000-000000000002') $$, '42501', null,
  'an administrator of another tenant cannot clean up here');
select throws_ok($$ select pg_temp.run(2) $$, 'PT102', null, 'the second tenant has no prerequisites of its own');

-- Leftovers are removed per tenant, never across tenants.
insert into private.sandbox_runs (id, tenant_id, location_id, reference, started_by)
values
  ('f1000000-0000-4000-8000-000000000001', (select t1 from scope), (select l1 from scope), 'SBX-LEFTOVR1', 'e1000000-0000-4000-8000-000000000001'),
  ('f2000000-0000-4000-8000-000000000002', (select t2 from scope), (select l2 from scope), 'SBX-LEFTOVR2', 'e2000000-0000-4000-8000-000000000002');
insert into private.sandbox_orders (run_id, tenant_id, location_id, reference, table_id, status, items, total_cents)
values
  ('f1000000-0000-4000-8000-000000000001', (select t1 from scope), (select l1 from scope), 'SBX-LEFTOVR1', 'eb000000-0000-4000-8000-00000000000b', 'placed', '[]'::jsonb, 100),
  ('f2000000-0000-4000-8000-000000000002', (select t2 from scope), (select l2 from scope), 'SBX-LEFTOVR2', 'eb000000-0000-4000-8000-00000000000b', 'placed', '[]'::jsonb, 100);
select is(private.cleanup_sandbox((select t1 from scope), (select l1 from scope),
  'e1000000-0000-4000-8000-000000000001'), 1, 'cleanup removes the simulated leftovers of the tenant');
select is((select count(*)::int from private.sandbox_orders where tenant_id = (select t2 from scope)), 1,
  'the other tenant simulated data is untouched');
select is((select count(*)::int from private.sandbox_orders where tenant_id = (select t1 from scope)), 0,
  'no simulated order survives for the tenant');

-- Re-running leaves real state intact, again.
select lives_ok($$ select pg_temp.run() $$, 'the circuit can be repeated');
select is((select pg_temp.real_state()), (select hash from before_state), 'real state is still identical');
select is((select count(*)::int from private.sandbox_runs where tenant_id = (select t1 from scope) and cleaned_at is not null), 3,
  'every run of the tenant ended clean');
select is((select count(*)::int from private.audit_events where tenant_id = (select t1 from scope) and action = 'sandbox.run_completed'), 2,
  'each completed run is audited');

select * from finish();
rollback;
