begin;

drop function if exists private.ack_business_media_job(bigint);
drop function if exists private.read_business_media_job(integer);
drop function if exists private.enqueue_business_media_processing(
  uuid, uuid, uuid, uuid
);

alter table private.business_media_assets
  drop constraint if exists business_media_assets_processing_pair_check,
  drop column if exists processing_started_at,
  drop column if exists processing_message_id;

select pgmq.drop_queue('business_media_processing');

commit;
