begin;

create table private.tenant_provisioning_requests (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid not null references auth.users(id) on delete restrict,
  idempotency_key_hash text not null check (idempotency_key_hash ~ '^[0-9a-f]{64}$'),
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  tenant_id uuid not null unique references public.tenants(id) on delete cascade,
  admin_email text not null check (
    admin_email = lower(btrim(admin_email))
    and length(admin_email) between 3 and 254
  ),
  status text not null default 'pending_invitation' check (
    status in ('pending_invitation', 'invited', 'activated')
  ),
  auth_user_id uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  invited_at timestamptz,
  activated_at timestamptz,
  unique (requested_by, idempotency_key_hash),
  check ((status = 'pending_invitation') = (auth_user_id is null)),
  check (status <> 'activated' or activated_at is not null)
);

create index tenant_provisioning_requests_status_idx
  on private.tenant_provisioning_requests (status, created_at);

revoke all on table private.tenant_provisioning_requests
from public, anon, authenticated;

create function private.begin_tenant_provisioning(
  actor_user_id uuid,
  target_idempotency_key_hash text,
  target_request_fingerprint text,
  target_slug text,
  target_name text,
  target_admin_email text
)
returns table (
  request_id uuid,
  tenant_id uuid,
  tenant_slug text,
  tenant_name text,
  location_id uuid,
  location_name text,
  admin_email text,
  provisioning_status text,
  auth_user_id uuid
)
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
declare
  existing_request private.tenant_provisioning_requests%rowtype;
  created_tenant_id uuid;
begin
  if not exists (
    select 1
    from public.platform_superadmins superadmin
    where superadmin.user_id = actor_user_id
  ) then
    raise exception using errcode = '42501', message = 'platform_superadmin_required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      actor_user_id::text || ':' || target_idempotency_key_hash,
      0
    )
  );

  select request.* into existing_request
  from private.tenant_provisioning_requests request
  where request.requested_by = actor_user_id
    and request.idempotency_key_hash = target_idempotency_key_hash;

  if found then
    if existing_request.request_fingerprint <> target_request_fingerprint then
      raise exception using errcode = 'P0001', message = 'idempotency_conflict';
    end if;

    return query
    select
      existing_request.id,
      tenant.id,
      tenant.slug,
      tenant.name,
      location.id,
      location.name,
      existing_request.admin_email,
      existing_request.status,
      existing_request.auth_user_id
    from public.tenants tenant
    inner join public.locations location
      on location.tenant_id = tenant.id and location.is_primary
    where tenant.id = existing_request.tenant_id;
    return;
  end if;

  insert into public.tenants (slug, name, status)
  values (target_slug, target_name, 'draft')
  returning id into created_tenant_id;

  insert into private.tenant_provisioning_requests (
    requested_by,
    idempotency_key_hash,
    request_fingerprint,
    tenant_id,
    admin_email
  ) values (
    actor_user_id,
    target_idempotency_key_hash,
    target_request_fingerprint,
    created_tenant_id,
    target_admin_email
  ) returning * into existing_request;

  return query
  select
    existing_request.id,
    tenant.id,
    tenant.slug,
    tenant.name,
    location.id,
    location.name,
    existing_request.admin_email,
    existing_request.status,
    existing_request.auth_user_id
  from public.tenants tenant
  inner join public.locations location
    on location.tenant_id = tenant.id and location.is_primary
  where tenant.id = existing_request.tenant_id;
end;
$$;

create function private.complete_tenant_provisioning(
  actor_user_id uuid,
  target_request_id uuid,
  target_auth_user_id uuid
)
returns table (
  request_id uuid,
  tenant_id uuid,
  tenant_slug text,
  tenant_name text,
  location_id uuid,
  location_name text,
  admin_email text,
  provisioning_status text,
  auth_user_id uuid
)
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
declare
  provisioning private.tenant_provisioning_requests%rowtype;
begin
  select request.* into provisioning
  from private.tenant_provisioning_requests request
  where request.id = target_request_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'provisioning_not_found';
  end if;

  if provisioning.requested_by <> actor_user_id
    or not exists (
      select 1
      from public.platform_superadmins superadmin
      where superadmin.user_id = actor_user_id
    ) then
    raise exception using errcode = '42501', message = 'platform_superadmin_required';
  end if;

  if provisioning.auth_user_id is not null
    and provisioning.auth_user_id <> target_auth_user_id then
    raise exception using errcode = 'P0001', message = 'invitation_identity_conflict';
  end if;

  insert into public.tenant_memberships (tenant_id, user_id, role)
  values (provisioning.tenant_id, target_auth_user_id, 'admin')
  on conflict on constraint tenant_memberships_pkey do nothing;

  update private.tenant_provisioning_requests request
  set
    status = case
      when request.status = 'activated' then 'activated'
      else 'invited'
    end,
    auth_user_id = target_auth_user_id,
    invited_at = coalesce(request.invited_at, now()),
    updated_at = now()
  where request.id = target_request_id
  returning request.* into provisioning;

  return query
  select
    provisioning.id,
    tenant.id,
    tenant.slug,
    tenant.name,
    location.id,
    location.name,
    provisioning.admin_email,
    provisioning.status,
    provisioning.auth_user_id
  from public.tenants tenant
  inner join public.locations location
    on location.tenant_id = tenant.id and location.is_primary
  where tenant.id = provisioning.tenant_id;
end;
$$;

revoke all on function private.begin_tenant_provisioning(
  uuid, text, text, text, text, text
) from public, anon, authenticated;
revoke all on function private.complete_tenant_provisioning(uuid, uuid, uuid)
from public, anon, authenticated;

grant usage on schema private to authenticator;
grant execute on function private.begin_tenant_provisioning(
  uuid, text, text, text, text, text
) to authenticator;
grant execute on function private.complete_tenant_provisioning(uuid, uuid, uuid)
to authenticator;

commit;
