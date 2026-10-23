begin;

create extension if not exists pgmq;
select pgmq.create('business_media_processing');

alter table private.business_media_assets
  add column processing_message_id bigint unique,
  add column processing_started_at timestamptz,
  add constraint business_media_assets_processing_pair_check check (
    (processing_message_id is null) = (processing_started_at is null)
  );

create or replace function private.enqueue_business_media_processing(
  target_tenant_id uuid,
  target_location_id uuid,
  target_requester_id uuid,
  target_asset_id uuid
)
returns private.business_media_assets
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  current_asset private.business_media_assets%rowtype;
  job_id uuid := gen_random_uuid();
  message_id bigint;
begin
  if not exists (
    select 1
    from public.tenant_memberships membership
    where membership.tenant_id = target_tenant_id
      and membership.user_id = target_requester_id
      and membership.role = 'admin'
  ) then
    raise exception 'tenant administrator authorization required'
      using errcode = '42501';
  end if;

  select *
  into current_asset
  from private.business_media_assets asset
  where asset.tenant_id = target_tenant_id
    and asset.location_id = target_location_id
    and asset.id = target_asset_id
  for update;

  if not found then
    raise exception 'business media asset does not belong to tenant location'
      using errcode = '42501';
  end if;

  if current_asset.processing_message_id is not null then
    return current_asset;
  end if;
  if current_asset.status <> 'reserved'
    or current_asset.reservation_expires_at <= statement_timestamp()
  then
    raise exception 'business media reservation is not active'
      using errcode = '22023';
  end if;

  select sent_message_id
  into message_id
  from pgmq.send(
    'business_media_processing',
    jsonb_build_object(
      'jobId', job_id,
      'kind', 'business-media.process',
      'payload', jsonb_build_object('assetId', current_asset.id),
      'scope', jsonb_build_object(
        'tenantId', current_asset.tenant_id,
        'locationId', current_asset.location_id
      )
    )
  ) sent_message_id;

  update private.business_media_assets asset
  set
    processing_message_id = message_id,
    processing_started_at = statement_timestamp(),
    updated_at = statement_timestamp()
  where asset.id = current_asset.id
  returning * into current_asset;

  return current_asset;
end;
$$;

revoke all on function private.enqueue_business_media_processing(
  uuid, uuid, uuid, uuid
) from public, anon, authenticated;
grant execute on function private.enqueue_business_media_processing(
  uuid, uuid, uuid, uuid
) to authenticator;

create or replace function private.read_business_media_job(
  target_visibility_timeout_seconds integer
)
returns table (
  message_id bigint,
  expected_tenant_id uuid,
  expected_location_id uuid,
  envelope jsonb
)
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
begin
  if target_visibility_timeout_seconds < 1
    or target_visibility_timeout_seconds > 3600
  then
    raise exception 'invalid business media visibility timeout'
      using errcode = '22023';
  end if;

  return query
  with queued_message as (
    select *
    from pgmq.read(
      'business_media_processing',
      target_visibility_timeout_seconds,
      1
    )
  )
  select
    queued.msg_id,
    asset.tenant_id,
    asset.location_id,
    queued.message
  from queued_message queued
  inner join private.business_media_assets asset
    on asset.processing_message_id = queued.msg_id
  where asset.status = 'reserved';
end;
$$;

revoke all on function private.read_business_media_job(integer)
from public, anon, authenticated;
grant execute on function private.read_business_media_job(integer)
to authenticator;

create or replace function private.ack_business_media_job(
  target_message_id bigint
)
returns boolean
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  asset_status text;
begin
  select asset.status
  into asset_status
  from private.business_media_assets asset
  where asset.processing_message_id = target_message_id
  for update;

  if not found then
    raise exception 'business media queue message is not registered'
      using errcode = '22023';
  end if;
  if asset_status not in ('ready', 'failed', 'deleted') then
    raise exception 'business media job is not terminal'
      using errcode = '22023';
  end if;

  perform pgmq.delete('business_media_processing', target_message_id);
  return true;
end;
$$;

revoke all on function private.ack_business_media_job(bigint)
from public, anon, authenticated;
grant execute on function private.ack_business_media_job(bigint)
to authenticator;

commit;
