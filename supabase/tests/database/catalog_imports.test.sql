begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(16);

insert into auth.users (id)
values
  ('a1100000-0000-4000-8000-000000000001'),
  ('a1200000-0000-4000-8000-000000000002');

insert into public.tenants (id, slug, name, status)
values
  ('a1300000-0000-4000-8000-000000000003', 'import-one', 'Import One', 'draft'),
  ('a1400000-0000-4000-8000-000000000004', 'import-two', 'Import Two', 'draft');

insert into public.tenant_memberships (tenant_id, user_id, role)
values
  ('a1300000-0000-4000-8000-000000000003', 'a1100000-0000-4000-8000-000000000001', 'admin'),
  ('a1400000-0000-4000-8000-000000000004', 'a1200000-0000-4000-8000-000000000002', 'admin');

select has_table('private', 'catalog_imports', 'catalog imports are private');
select ok(
  to_regclass('pgmq.q_catalog_import_processing') is not null,
  'the durable catalog import queue exists'
);
select table_privs_are(
  'private',
  'catalog_imports',
  'authenticator',
  array[]::text[],
  'the runtime cannot bypass catalog import functions'
);

create temporary table queued_import on commit drop as
select * from private.enqueue_catalog_import(
  'a1300000-0000-4000-8000-000000000003',
  (select id from public.locations where tenant_id = 'a1300000-0000-4000-8000-000000000003'),
  'a1100000-0000-4000-8000-000000000001',
  'a1500000-0000-4000-8000-000000000005',
  'manual',
  '{"kind":"manual","rows":[{"category":"Café","description":"","name":"Cortado","price":"1500","sector":"Barra"}]}'::jsonb
);

-- The queue is shared with the whole database: compare against its size now.
create temporary table queue_before on commit drop as
select count(*) as total from pgmq.q_catalog_import_processing;

select is((select status from queued_import), 'queued', 'new imports start queued');
select ok(
  (select processing_message_id is not null from queued_import),
  'enqueue records the durable message identity'
);
select is(
  (
    select processing_message_id from private.enqueue_catalog_import(
      'a1300000-0000-4000-8000-000000000003',
      (select location_id from queued_import),
      'a1100000-0000-4000-8000-000000000001',
      'a1500000-0000-4000-8000-000000000005',
      'manual',
      (select source from queued_import)
    )
  ),
  (select processing_message_id from queued_import),
  'repeating an idempotency key returns the original import'
);
select is(
  (select count(*) from pgmq.q_catalog_import_processing),
  (select total from queue_before),
  'an idempotent retry does not duplicate the queue message'
);
select throws_ok(
  $$
    select * from private.get_catalog_import(
      'a1300000-0000-4000-8000-000000000003',
      (select location_id from queued_import),
      'a1200000-0000-4000-8000-000000000002',
      (select id from queued_import)
    )
  $$,
  '42501',
  null,
  'an administrator from another tenant cannot read the import'
);

create temporary table claimed_job on commit drop as
select * from private.read_catalog_import_job(60);

select results_eq(
  $$ select expected_tenant_id, expected_location_id from claimed_job $$,
  $$ select tenant_id, location_id from queued_import $$,
  'the worker receives scope from the durable import record'
);
select is(
  (select envelope->>'kind' from claimed_job),
  'catalog-import.process',
  'the message contains the canonical job kind'
);
select results_eq(
  $$
    select attempt_count, source->>'kind'
    from private.claim_catalog_import(
      'a1300000-0000-4000-8000-000000000003',
      (select location_id from queued_import),
      (select id from queued_import)
    )
  $$,
  $$ values (1, 'manual'::text) $$,
  'claiming increments attempts and returns the private source'
);
select is(
  (select source is not null from private.catalog_imports where id = (select id from queued_import)),
  true,
  'the source remains available while a retry may still be needed'
);

create temporary table reviewed_import on commit drop as
select * from private.complete_catalog_import(
  'a1300000-0000-4000-8000-000000000003',
  (select location_id from queued_import),
  (select id from queued_import),
  '{"errors":[],"items":[{"category":{"confidence":1,"doubtful":false,"value":"Café"},"description":{"confidence":1,"doubtful":false,"value":""},"id":"a1600000-0000-4000-8000-000000000006","issues":[],"name":{"confidence":1,"doubtful":false,"value":"Cortado"},"priceCents":{"confidence":1,"doubtful":false,"value":150000},"rowNumber":1,"sector":{"confidence":1,"doubtful":false,"value":"Barra"}}],"overallConfidence":1}'::jsonb
);

select is((select status from reviewed_import), 'review', 'processing creates a review draft');
select is((select source is null from reviewed_import), true, 'raw source is removed after normalization');
select ok(
  private.ack_catalog_import_job((select message_id from claimed_job)),
  'a reviewable job is terminal and can be acknowledged'
);
select is(
  (
    select status from private.approve_catalog_import(
      'a1300000-0000-4000-8000-000000000003',
      (select location_id from queued_import),
      'a1100000-0000-4000-8000-000000000001',
      (select id from queued_import),
      (select draft from reviewed_import)
    )
  ),
  'approved',
  'only an explicit approval advances the import'
);

select * from finish();
rollback;
