begin;

create extension if not exists pgmq;
select pgmq.create('catalog_import_processing');

create table private.catalog_imports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  location_id uuid not null,
  requester_id uuid not null,
  idempotency_key uuid not null,
  source_kind text not null check (source_kind in ('manual', 'csv', 'xlsx', 'pdf', 'image')),
  source jsonb,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'review', 'approved', 'discarded', 'failed')),
  draft jsonb,
  attempt_count integer not null default 0 check (attempt_count between 0 and 20),
  processing_message_id bigint unique,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  approved_at timestamptz,
  discarded_at timestamptz,
  constraint catalog_imports_tenant_location_fkey
    foreign key (tenant_id, location_id)
    references public.locations(tenant_id, id) on delete cascade,
  constraint catalog_imports_idempotency_key
    unique (tenant_id, location_id, idempotency_key),
  constraint catalog_imports_source_lifecycle_check check (
    (status in ('queued', 'processing') and source is not null)
    or (status in ('review', 'approved', 'discarded', 'failed') and source is null)
  ),
  constraint catalog_imports_draft_lifecycle_check check (
    (status in ('review', 'approved') and draft is not null)
    or (status not in ('review', 'approved'))
  ),
  constraint catalog_imports_terminal_timestamp_check check (
    (status = 'approved') = (approved_at is not null)
    and (status = 'discarded') = (discarded_at is not null)
  )
);

create index catalog_imports_tenant_location_created_idx
on private.catalog_imports (tenant_id, location_id, created_at desc);

revoke all on table private.catalog_imports from public, anon, authenticated;

create or replace function private.assert_catalog_import_admin(
  target_tenant_id uuid,
  target_location_id uuid,
  target_requester_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
begin
  if not exists (
    select 1
    from public.tenant_memberships membership
    inner join public.locations location
      on location.tenant_id = membership.tenant_id
    where membership.tenant_id = target_tenant_id
      and membership.user_id = target_requester_id
      and membership.role = 'admin'
      and location.id = target_location_id
  ) then
    raise exception 'tenant administrator authorization required'
      using errcode = '42501';
  end if;
end;
$$;

revoke all on function private.assert_catalog_import_admin(uuid, uuid, uuid)
from public, anon, authenticated;

create or replace function private.enqueue_catalog_import(
  target_tenant_id uuid,
  target_location_id uuid,
  target_requester_id uuid,
  target_idempotency_key uuid,
  target_source_kind text,
  target_source jsonb
)
returns private.catalog_imports
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  current_import private.catalog_imports%rowtype;
  message_id bigint;
begin
  perform private.assert_catalog_import_admin(
    target_tenant_id,
    target_location_id,
    target_requester_id
  );
  if target_source_kind not in ('manual', 'csv', 'xlsx', 'pdf', 'image')
    or target_source is null
    or pg_column_size(target_source) > 12000000
  then
    raise exception 'catalog import source is invalid' using errcode = '22023';
  end if;

  insert into private.catalog_imports (
    tenant_id,
    location_id,
    requester_id,
    idempotency_key,
    source_kind,
    source
  ) values (
    target_tenant_id,
    target_location_id,
    target_requester_id,
    target_idempotency_key,
    target_source_kind,
    target_source
  )
  on conflict (tenant_id, location_id, idempotency_key) do nothing;

  select * into current_import
  from private.catalog_imports item
  where item.tenant_id = target_tenant_id
    and item.location_id = target_location_id
    and item.idempotency_key = target_idempotency_key
  for update;

  if current_import.requester_id <> target_requester_id
    or current_import.source_kind <> target_source_kind
    or (current_import.source is not null and current_import.source <> target_source)
  then
    raise exception 'idempotency key already belongs to another catalog import'
      using errcode = '23505';
  end if;

  if current_import.processing_message_id is null then
    select sent_message_id into message_id
    from pgmq.send(
      'catalog_import_processing',
      jsonb_build_object(
        'jobId', gen_random_uuid(),
        'kind', 'catalog-import.process',
        'payload', jsonb_build_object('importId', current_import.id),
        'scope', jsonb_build_object(
          'tenantId', current_import.tenant_id,
          'locationId', current_import.location_id
        )
      )
    ) sent_message_id;

    update private.catalog_imports item
    set processing_message_id = message_id, updated_at = statement_timestamp()
    where item.id = current_import.id
    returning * into current_import;
  end if;

  return current_import;
end;
$$;

create or replace function private.list_catalog_imports(
  target_tenant_id uuid,
  target_location_id uuid,
  target_requester_id uuid
)
returns setof private.catalog_imports
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
begin
  perform private.assert_catalog_import_admin(
    target_tenant_id,
    target_location_id,
    target_requester_id
  );
  return query
  select item.*
  from private.catalog_imports item
  where item.tenant_id = target_tenant_id
    and item.location_id = target_location_id
  order by item.created_at desc
  limit 20;
end;
$$;

create or replace function private.get_catalog_import(
  target_tenant_id uuid,
  target_location_id uuid,
  target_requester_id uuid,
  target_import_id uuid
)
returns setof private.catalog_imports
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
begin
  perform private.assert_catalog_import_admin(
    target_tenant_id,
    target_location_id,
    target_requester_id
  );
  return query
  select item.*
  from private.catalog_imports item
  where item.tenant_id = target_tenant_id
    and item.location_id = target_location_id
    and item.id = target_import_id;
end;
$$;

create or replace function private.read_catalog_import_job(
  target_visibility_timeout_seconds integer
)
returns table (
  message_id bigint,
  read_count bigint,
  expected_tenant_id uuid,
  expected_location_id uuid,
  import_status text,
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
    raise exception 'invalid catalog import visibility timeout'
      using errcode = '22023';
  end if;
  return query
  with queued_message as (
    select * from pgmq.read(
      'catalog_import_processing',
      target_visibility_timeout_seconds,
      1
    )
  )
  select
    queued.msg_id,
    queued.read_ct::bigint,
    item.tenant_id,
    item.location_id,
    item.status,
    queued.message
  from queued_message queued
  inner join private.catalog_imports item
    on item.processing_message_id = queued.msg_id;
end;
$$;

create or replace function private.claim_catalog_import(
  target_tenant_id uuid,
  target_location_id uuid,
  target_import_id uuid
)
returns table (attempt_count integer, source jsonb)
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
begin
  return query
  update private.catalog_imports item
  set
    status = 'processing',
    attempt_count = item.attempt_count + 1,
    updated_at = statement_timestamp()
  where item.tenant_id = target_tenant_id
    and item.location_id = target_location_id
    and item.id = target_import_id
    and item.status in ('queued', 'processing')
    and item.processing_message_id is not null
    and item.attempt_count < 20
  returning item.attempt_count, item.source;
end;
$$;

create or replace function private.complete_catalog_import(
  target_tenant_id uuid,
  target_location_id uuid,
  target_import_id uuid,
  target_draft jsonb
)
returns private.catalog_imports
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  current_import private.catalog_imports%rowtype;
begin
  if target_draft is null or pg_column_size(target_draft) > 4000000 then
    raise exception 'catalog import draft is invalid' using errcode = '22023';
  end if;
  update private.catalog_imports item
  set
    status = 'review',
    source = null,
    draft = target_draft,
    updated_at = statement_timestamp()
  where item.tenant_id = target_tenant_id
    and item.location_id = target_location_id
    and item.id = target_import_id
    and item.status = 'processing'
  returning * into current_import;
  if not found then
    raise exception 'catalog import is not processing for this scope'
      using errcode = '22023';
  end if;
  return current_import;
end;
$$;

create or replace function private.fail_catalog_import(
  target_tenant_id uuid,
  target_location_id uuid,
  target_import_id uuid
)
returns private.catalog_imports
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  current_import private.catalog_imports%rowtype;
begin
  update private.catalog_imports item
  set status = 'failed', source = null, draft = null, updated_at = statement_timestamp()
  where item.tenant_id = target_tenant_id
    and item.location_id = target_location_id
    and item.id = target_import_id
    and item.status in ('queued', 'processing')
  returning * into current_import;
  if not found then
    raise exception 'catalog import cannot be failed for this scope'
      using errcode = '22023';
  end if;
  return current_import;
end;
$$;

create or replace function private.approve_catalog_import(
  target_tenant_id uuid,
  target_location_id uuid,
  target_requester_id uuid,
  target_import_id uuid,
  target_draft jsonb
)
returns private.catalog_imports
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  current_import private.catalog_imports%rowtype;
begin
  perform private.assert_catalog_import_admin(
    target_tenant_id,
    target_location_id,
    target_requester_id
  );
  update private.catalog_imports item
  set
    status = 'approved',
    draft = target_draft,
    approved_at = statement_timestamp(),
    updated_at = statement_timestamp()
  where item.tenant_id = target_tenant_id
    and item.location_id = target_location_id
    and item.id = target_import_id
    and item.status = 'review'
  returning * into current_import;
  if not found then
    select * into current_import
    from private.catalog_imports item
    where item.tenant_id = target_tenant_id
      and item.location_id = target_location_id
      and item.id = target_import_id
      and item.status = 'approved'
      and item.draft = target_draft;
  end if;
  if not found then
    raise exception 'catalog import is not reviewable for this scope'
      using errcode = '22023';
  end if;
  return current_import;
end;
$$;

create or replace function private.discard_catalog_import(
  target_tenant_id uuid,
  target_location_id uuid,
  target_requester_id uuid,
  target_import_id uuid
)
returns private.catalog_imports
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  current_import private.catalog_imports%rowtype;
begin
  perform private.assert_catalog_import_admin(
    target_tenant_id,
    target_location_id,
    target_requester_id
  );
  update private.catalog_imports item
  set
    status = 'discarded',
    source = null,
    draft = null,
    discarded_at = statement_timestamp(),
    updated_at = statement_timestamp()
  where item.tenant_id = target_tenant_id
    and item.location_id = target_location_id
    and item.id = target_import_id
    and item.status in ('queued', 'processing', 'review', 'failed')
  returning * into current_import;
  if not found then
    select * into current_import
    from private.catalog_imports item
    where item.tenant_id = target_tenant_id
      and item.location_id = target_location_id
      and item.id = target_import_id
      and item.status = 'discarded';
  end if;
  if not found then
    raise exception 'catalog import cannot be discarded for this scope'
      using errcode = '22023';
  end if;
  return current_import;
end;
$$;

create or replace function private.ack_catalog_import_job(target_message_id bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  import_status text;
begin
  select item.status into import_status
  from private.catalog_imports item
  where item.processing_message_id = target_message_id
  for update;
  if not found then
    raise exception 'catalog import queue message is not registered'
      using errcode = '22023';
  end if;
  if import_status not in ('review', 'approved', 'discarded', 'failed') then
    raise exception 'catalog import job is not terminal' using errcode = '22023';
  end if;
  perform pgmq.delete('catalog_import_processing', target_message_id);
  return true;
end;
$$;

revoke all on function private.enqueue_catalog_import(uuid, uuid, uuid, uuid, text, jsonb)
from public, anon, authenticated;
revoke all on function private.list_catalog_imports(uuid, uuid, uuid)
from public, anon, authenticated;
revoke all on function private.get_catalog_import(uuid, uuid, uuid, uuid)
from public, anon, authenticated;
revoke all on function private.read_catalog_import_job(integer)
from public, anon, authenticated;
revoke all on function private.claim_catalog_import(uuid, uuid, uuid)
from public, anon, authenticated;
revoke all on function private.complete_catalog_import(uuid, uuid, uuid, jsonb)
from public, anon, authenticated;
revoke all on function private.fail_catalog_import(uuid, uuid, uuid)
from public, anon, authenticated;
revoke all on function private.approve_catalog_import(uuid, uuid, uuid, uuid, jsonb)
from public, anon, authenticated;
revoke all on function private.discard_catalog_import(uuid, uuid, uuid, uuid)
from public, anon, authenticated;
revoke all on function private.ack_catalog_import_job(bigint)
from public, anon, authenticated;

grant execute on function private.enqueue_catalog_import(uuid, uuid, uuid, uuid, text, jsonb)
to authenticator;
grant execute on function private.list_catalog_imports(uuid, uuid, uuid)
to authenticator;
grant execute on function private.get_catalog_import(uuid, uuid, uuid, uuid)
to authenticator;
grant execute on function private.read_catalog_import_job(integer)
to authenticator;
grant execute on function private.claim_catalog_import(uuid, uuid, uuid)
to authenticator;
grant execute on function private.complete_catalog_import(uuid, uuid, uuid, jsonb)
to authenticator;
grant execute on function private.fail_catalog_import(uuid, uuid, uuid)
to authenticator;
grant execute on function private.approve_catalog_import(uuid, uuid, uuid, uuid, jsonb)
to authenticator;
grant execute on function private.discard_catalog_import(uuid, uuid, uuid, uuid)
to authenticator;
grant execute on function private.ack_catalog_import_job(bigint)
to authenticator;

commit;
