begin;

drop function private.read_business_media_job(integer);

create function private.read_business_media_job(
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

commit;
