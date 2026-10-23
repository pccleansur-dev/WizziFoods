begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(21);

insert into auth.users (id)
values
  ('f1000000-0000-4000-8000-000000000001'),
  ('f2000000-0000-4000-8000-000000000002');

insert into public.tenants (id, slug, name, status)
values
  ('f3000000-0000-4000-8000-000000000003', 'queue-one', 'Queue One', 'draft'),
  ('f4000000-0000-4000-8000-000000000004', 'queue-two', 'Queue Two', 'draft');

insert into public.tenant_memberships (tenant_id, user_id, role)
values
  ('f3000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000001', 'admin'),
  ('f4000000-0000-4000-8000-000000000004', 'f2000000-0000-4000-8000-000000000002', 'admin');

select has_extension('pgmq', 'the durable queue extension is installed');
select ok(
  to_regclass('pgmq.q_business_media_processing') is not null,
  'the business media queue exists'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'private.enqueue_business_media_processing(uuid,uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'browser identities cannot enqueue media directly'
);

create temporary table reserved_asset on commit drop as
select *
from private.reserve_business_media_asset(
  'f3000000-0000-4000-8000-000000000003',
  (select id from public.locations where tenant_id = 'f3000000-0000-4000-8000-000000000003'),
  'f1000000-0000-4000-8000-000000000001',
  'cover',
  'image/webp',
  4096
);

select throws_ok(
  $$
    select * from private.enqueue_business_media_processing(
      'f3000000-0000-4000-8000-000000000003',
      (select id from public.locations where tenant_id = 'f3000000-0000-4000-8000-000000000003'),
      'f2000000-0000-4000-8000-000000000002',
      (select id from reserved_asset)
    )
  $$,
  '42501',
  null,
  'an administrator from another tenant cannot enqueue the asset'
);

select throws_ok(
  $$
    select * from private.enqueue_business_media_processing(
      'f3000000-0000-4000-8000-000000000003',
      (select location_id from reserved_asset),
      'f1000000-0000-4000-8000-000000000001',
      (select id from reserved_asset)
    )
  $$,
  '22023',
  null,
  'a reservation cannot be queued before its object exists'
);

insert into storage.objects (bucket_id, name)
select 'business-media', object_path
from reserved_asset;

create temporary table queued_asset on commit drop as
select *
from private.enqueue_business_media_processing(
  'f3000000-0000-4000-8000-000000000003',
  (select id from public.locations where tenant_id = 'f3000000-0000-4000-8000-000000000003'),
  'f1000000-0000-4000-8000-000000000001',
  (select id from reserved_asset)
);

select ok(
  (select processing_message_id is not null from queued_asset),
  'an active reservation records its durable message'
);
select is(
  (select reservation_expires_at from queued_asset),
  'infinity'::timestamptz,
  'a queued asset keeps consuming quota until it reaches a terminal state'
);
select results_eq(
  $$
    select
      message->>'kind',
      message#>>'{payload,assetId}',
      message#>>'{scope,tenantId}',
      message#>>'{scope,locationId}'
    from pgmq.q_business_media_processing
  $$,
  $$
    values (
      'business-media.process'::text,
      (select id::text from reserved_asset),
      'f3000000-0000-4000-8000-000000000003'::text,
      (select location_id::text from reserved_asset)
    )
  $$,
  'the queue envelope contains only canonical scoped identifiers'
);
select is(
  (
    select processing_message_id
    from private.enqueue_business_media_processing(
      'f3000000-0000-4000-8000-000000000003',
      (select location_id from reserved_asset),
      'f1000000-0000-4000-8000-000000000001',
      (select id from reserved_asset)
    )
  ),
  (select processing_message_id from queued_asset),
  'enqueue is idempotent for the same reservation'
);
select is(
  (select count(*) from pgmq.q_business_media_processing),
  1::bigint,
  'an enqueue retry does not duplicate the job'
);
select is(
  (
    select status
    from private.get_business_media_asset_status(
      'f3000000-0000-4000-8000-000000000003',
      (select location_id from reserved_asset),
      'f1000000-0000-4000-8000-000000000001',
      (select id from reserved_asset)
    )
  ),
  'reserved'::text,
  'the tenant administrator can read processing status'
);
select throws_ok(
  $$
    select * from private.get_business_media_asset_status(
      'f3000000-0000-4000-8000-000000000003',
      (select location_id from reserved_asset),
      'f2000000-0000-4000-8000-000000000002',
      (select id from reserved_asset)
    )
  $$,
  '42501',
  null,
  'an administrator from another tenant cannot read processing status'
);

select results_eq(
  $$
    select kind, content_type, object_path
    from private.claim_business_media_asset(
      'f3000000-0000-4000-8000-000000000003',
      (select location_id from reserved_asset),
      (select id from reserved_asset)
    )
  $$,
  $$ select kind, content_type, object_path from reserved_asset $$,
  'the worker claims trusted media metadata from the database'
);
select throws_ok(
  $$
    select * from private.claim_business_media_asset(
      'f4000000-0000-4000-8000-000000000004',
      (select id from public.locations where tenant_id = 'f4000000-0000-4000-8000-000000000004'),
      (select id from reserved_asset)
    )
  $$,
  '22023',
  null,
  'the worker cannot claim media through a different tenant scope'
);

create temporary table claimed_job on commit drop as
select * from private.read_business_media_job(60);

select results_eq(
  $$ select expected_tenant_id, expected_location_id from claimed_job $$,
  $$ select tenant_id, location_id from reserved_asset $$,
  'the worker receives trusted scope from the asset record'
);
select is(
  (select envelope->>'kind' from claimed_job),
  'business-media.process',
  'the worker receives the stored envelope'
);
select throws_ok(
  $$
    select private.ack_business_media_job(
      (select message_id from claimed_job)
    )
  $$,
  '22023',
  null,
  'a job cannot be acknowledged before a terminal asset state'
);

select private.fail_business_media_asset(
  'f3000000-0000-4000-8000-000000000003',
  (select id from reserved_asset)
);

update pgmq.q_business_media_processing
set vt = clock_timestamp()
where msg_id = (select message_id from claimed_job);

create temporary table recovered_job on commit drop as
select * from private.read_business_media_job(60);

select is(
  (select asset_status from recovered_job),
  'failed'::text,
  'a terminal message can be recovered after acknowledgement interruption'
);
select is(
  (select message_id from recovered_job),
  (select message_id from claimed_job),
  'the recovered terminal message keeps its durable identity'
);

select ok(
  private.ack_business_media_job((select message_id from recovered_job)),
  'a terminal job can be acknowledged'
);
select is(
  (select count(*) from pgmq.q_business_media_processing),
  0::bigint,
  'acknowledgement removes the durable message'
);

select * from finish();
rollback;
