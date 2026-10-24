begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(17);

insert into auth.users (id) values ('18100000-0000-4000-8000-000000000001');
insert into public.tenants (id, slug, name, status) values
  ('18200000-0000-4000-8000-000000000001', 'intent-one', 'Intent One', 'active'),
  ('18200000-0000-4000-8000-000000000002', 'intent-two', 'Intent Two', 'active');
insert into public.tenant_memberships (tenant_id, user_id, role)
values ('18200000-0000-4000-8000-000000000001', '18100000-0000-4000-8000-000000000001', 'admin');

create temporary table scope as select
  '18200000-0000-4000-8000-000000000001'::uuid t1,
  (select id from public.locations where tenant_id = '18200000-0000-4000-8000-000000000001') l1,
  '18200000-0000-4000-8000-000000000002'::uuid t2,
  (select id from public.locations where tenant_id = '18200000-0000-4000-8000-000000000002') l2;

select private.save_floor_plan(
  (select t1 from scope), (select l1 from scope),
  '18100000-0000-4000-8000-000000000001',
  '18300000-0000-4000-8000-000000000001', 0,
  jsonb_build_object(
    'floors', jsonb_build_array(jsonb_build_object(
      'id','18400000-0000-4000-8000-000000000001','name','Planta baja','position',0,'shortName',null)),
    'sectors', jsonb_build_array(jsonb_build_object(
      'id','18500000-0000-4000-8000-000000000001','name','Salón','position',0)),
    'tables', jsonb_build_array(jsonb_build_object(
      'id','18600000-0000-4000-8000-000000000001','label','4',
      'sectorId','18500000-0000-4000-8000-000000000001',
      'floorId','18400000-0000-4000-8000-000000000001',
      'shape','square','x',40,'y',40,'width',100,'height',100,
      'rotation',0,'seatCount',4,'seatLayout','perimeter')),
    'groups', '[]'::jsonb
  )
);

create temporary table fixture as select
  (select token from private.list_floor_table_qr_codes(
    (select t1 from scope), (select l1 from scope),
    '18100000-0000-4000-8000-000000000001')) token,
  '18700000-0000-4000-8000-000000000001'::uuid product_id,
  '18700000-0000-4000-8000-000000000002'::uuid variant_id,
  '18700000-0000-4000-8000-000000000003'::uuid line_id;

insert into private.location_publications (tenant_id, location_id, published_by)
values ((select t1 from scope), (select l1 from scope), '18100000-0000-4000-8000-000000000001');
insert into private.published_catalogs (
  tenant_id, location_id, revision, source_draft_revision, snapshot, published_by
) values (
  (select t1 from scope), (select l1 from scope), 1, 1,
  jsonb_build_object(
    'baseRevision', null,
    'categories', jsonb_build_array(jsonb_build_object(
      'id','18800000-0000-4000-8000-000000000001','position',0,
      'content',jsonb_build_array(jsonb_build_object('language','es','title','Platos','description','')))),
    'sectors', jsonb_build_array(jsonb_build_object(
      'id','18800000-0000-4000-8000-000000000002','position',0,'name','Cocina','kind','kitchen')),
    'products', jsonb_build_array(jsonb_build_object(
      'id',(select product_id from fixture),'categoryId','18800000-0000-4000-8000-000000000001',
      'sectorId','18800000-0000-4000-8000-000000000002','position',0,'priceCents',12500,
      'imageAssetId',null,
      'content',jsonb_build_array(jsonb_build_object('language','es','title','Milanesa','description','Con papas')),
      'variants',jsonb_build_array(jsonb_build_object(
        'id',(select variant_id from fixture),'position',0,'priceDeltaCents',2500,
        'content',jsonb_build_array(jsonb_build_object('language','es','title','Napolitana','description',''))))))
  ),
  '18100000-0000-4000-8000-000000000001'
);
select private.ensure_payment_methods((select t1 from scope), (select l1 from scope));

create function pg_temp.items(quantity integer default 2, variant boolean default true)
returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object(
    'lineId', (select line_id from fixture),
    'productId', (select product_id from fixture),
    'variantId', case when variant then to_jsonb((select variant_id from fixture)::text) else 'null'::jsonb end,
    'quantity', quantity))
$$;

create function pg_temp.intent(command_id uuid, method text default 'cash', path text default 'in_person',
  attribution text default 'table', seat text default null, items jsonb default pg_temp.items())
returns jsonb language sql as $$
  select private.create_order_intent(
    (select t1 from scope), (select l1 from scope), (select token from fixture),
    command_id, attribution, 'Valentín', seat, method, path, items)
$$;

select has_function('private', 'create_order_intent',
  array['uuid','uuid','text','uuid','text','text','text','text','text','jsonb'],
  'order intents are created through one scoped function');
select has_function('private', 'list_public_payment_methods', array['uuid','uuid'],
  'public payment choices are read through a scoped function');
select results_eq(
  $$ select method, payment_path from private.list_public_payment_methods((select t1 from scope), (select l1 from scope)) $$,
  $$ values ('cash'::text, 'in_person'::text) $$,
  'only enabled and configured payment methods are public');

create temporary table first_result as
select pg_temp.intent('18900000-0000-4000-8000-000000000001') result;
select is((select result ->> 'status' from first_result), 'awaiting_waiter',
  'an in-person intent waits for the waiter');
select is((select (result ->> 'totalCents')::integer from first_result), 30000,
  'prices and totals come from the current publication');
select is((select result #>> '{items,0,title}' from first_result), 'Milanesa',
  'the accepted item snapshot keeps its server title');
select is((select count(*)::integer from private.order_intents where tenant_id = (select t1 from scope)), 1,
  'the intent is persisted');
select is((select count(*)::integer from private.waiter_calls where tenant_id = (select t1 from scope) and status = 'open'), 1,
  'the in-person path creates one open waiter call');
select is(pg_temp.intent('18900000-0000-4000-8000-000000000001'), (select result from first_result),
  'an identical command replays the persisted result');
select is((select count(*)::integer from private.order_intents where tenant_id = (select t1 from scope)), 1,
  'an idempotent replay does not duplicate the intent');
select throws_ok(
  $$ select pg_temp.intent('18900000-0000-4000-8000-000000000001', items => pg_temp.items(1)) $$,
  'PT100', null, 'a command id cannot be reused for a different payload');
select throws_ok(
  $$ select pg_temp.intent('18900000-0000-4000-8000-000000000002', attribution => 'individual') $$,
  'PT107', null, 'individual attribution requires a seat');

update private.payment_methods set enabled = true, public_config = '{"publicKey":"TEST_PUBLIC_KEY"}'
where tenant_id = (select t1 from scope) and location_id = (select l1 from scope) and method_key = 'mercado_pago';
insert into private.payment_method_secrets (tenant_id, location_id, method_key, ciphertext, key_version)
values ((select t1 from scope), (select l1 from scope), 'mercado_pago', decode(repeat('ab', 29), 'hex'), 1);
create temporary table online_result as
select pg_temp.intent('18900000-0000-4000-8000-000000000003', 'mercado_pago', 'online',
  'individual', 'Silla 2') result;
select results_eq(
  $$ select result ->> 'status', result ->> 'callId' from online_result $$,
  $$ values ('payment_pending'::text, null::text) $$,
  'online creates only a pending payment intent and no waiter call');

insert into private.catalog_product_availability (
  tenant_id, location_id, product_id, is_available, updated_by
) values ((select t1 from scope), (select l1 from scope), (select product_id from fixture), false,
  '18100000-0000-4000-8000-000000000001');
select throws_ok(
  $$ select pg_temp.intent('18900000-0000-4000-8000-000000000004') $$,
  'PT104', null, 'availability is revalidated atomically');
delete from private.catalog_product_availability where tenant_id = (select t1 from scope);
insert into private.product_operational_stock (tenant_id, location_id, product_id, available_quantity)
values ((select t1 from scope), (select l1 from scope), (select product_id from fixture), 1);
select throws_ok(
  $$ select pg_temp.intent('18900000-0000-4000-8000-000000000005') $$,
  'PT106', null, 'optional operational stock is revalidated without reserving it');
select is((select available_quantity from private.product_operational_stock where tenant_id = (select t1 from scope)), 1,
  'a pending intent does not reserve or decrement stock');
select throws_ok(
  $$ select private.create_order_intent(
    (select t2 from scope), (select l2 from scope), (select token from fixture),
    '18900000-0000-4000-8000-000000000006', 'table', 'Intruso', null,
    'cash', 'in_person', pg_temp.items()) $$,
  'PT101', null, 'a QR never crosses tenant or location scope');

select * from finish();
rollback;
