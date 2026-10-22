begin;

create table private.support_access_grants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  support_user_id uuid not null references public.platform_superadmins(user_id) on delete restrict,
  granted_by uuid not null,
  reason text not null check (
    reason = btrim(reason)
    and length(reason) between 3 and 500
  ),
  granted_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid,
  revocation_reason text,
  constraint support_access_grants_tenant_support_key
    unique (tenant_id, support_user_id),
  foreign key (tenant_id, granted_by)
    references public.tenant_memberships(tenant_id, user_id)
    on delete restrict,
  foreign key (tenant_id, revoked_by)
    references public.tenant_memberships(tenant_id, user_id)
    on delete restrict,
  check (
    expires_at > granted_at
    and expires_at <= granted_at + interval '4 hours'
  ),
  check (
    (
      revoked_at is null
      and revoked_by is null
      and revocation_reason is null
    )
    or (
      revoked_at is not null
      and revoked_at >= granted_at
      and revoked_by is not null
      and revocation_reason = btrim(revocation_reason)
      and length(revocation_reason) between 3 and 500
    )
  )
);

create index support_access_grants_tenant_expiry_idx
  on private.support_access_grants (tenant_id, expires_at desc);

revoke all on table private.support_access_grants
from public, anon, authenticated, authenticator;

create or replace function private.grant_support_access(
  target_tenant_id uuid,
  target_support_user_id uuid,
  target_granted_by uuid,
  target_reason text,
  target_duration_minutes integer,
  target_correlation_id text
)
returns table (
  id uuid,
  support_user_id uuid,
  reason text,
  granted_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  status text
)
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  authorized_at timestamptz := statement_timestamp();
  grant_id uuid;
begin
  if target_duration_minutes < 15 or target_duration_minutes > 240 then
    raise exception 'support duration must be between 15 and 240 minutes'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.tenant_memberships membership
    where membership.tenant_id = target_tenant_id
      and membership.user_id = target_granted_by
      and membership.role = 'admin'
  ) then
    raise exception 'tenant administrator authorization required'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.platform_superadmins superadmin
    where superadmin.user_id = target_support_user_id
  ) then
    raise exception 'support identity is not eligible'
      using errcode = '42501';
  end if;

  insert into private.support_access_grants (
    tenant_id,
    support_user_id,
    granted_by,
    reason,
    granted_at,
    expires_at
  ) values (
    target_tenant_id,
    target_support_user_id,
    target_granted_by,
    btrim(target_reason),
    authorized_at,
    authorized_at + make_interval(mins => target_duration_minutes)
  )
  on conflict on constraint support_access_grants_tenant_support_key do update
  set
    granted_by = excluded.granted_by,
    reason = excluded.reason,
    granted_at = excluded.granted_at,
    expires_at = excluded.expires_at,
    revoked_at = null,
    revoked_by = null,
    revocation_reason = null
  returning private.support_access_grants.id into grant_id;

  perform private.append_audit_event(
    target_tenant_id,
    'tenant_admin',
    target_granted_by,
    'support_access.granted',
    btrim(target_reason),
    target_correlation_id,
    'support_access',
    grant_id
  );

  return query
  select
    grant_record.id,
    grant_record.support_user_id,
    grant_record.reason,
    grant_record.granted_at,
    grant_record.expires_at,
    grant_record.revoked_at,
    'active'::text
  from private.support_access_grants grant_record
  where grant_record.id = grant_id;
end;
$$;

create or replace function private.revoke_support_access(
  target_tenant_id uuid,
  target_grant_id uuid,
  target_revoked_by uuid,
  target_reason text,
  target_correlation_id text
)
returns table (
  id uuid,
  support_user_id uuid,
  reason text,
  granted_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  status text
)
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  existing_grant private.support_access_grants%rowtype;
begin
  if not exists (
    select 1
    from public.tenant_memberships membership
    where membership.tenant_id = target_tenant_id
      and membership.user_id = target_revoked_by
      and membership.role = 'admin'
  ) then
    raise exception 'tenant administrator authorization required'
      using errcode = '42501';
  end if;

  select grant_record.*
  into existing_grant
  from private.support_access_grants grant_record
  where grant_record.tenant_id = target_tenant_id
    and grant_record.id = target_grant_id
  for update;

  if not found then
    raise exception 'support grant was not found'
      using errcode = '22023';
  end if;

  if existing_grant.revoked_at is null then
    update private.support_access_grants grant_record
    set
      revoked_at = statement_timestamp(),
      revoked_by = target_revoked_by,
      revocation_reason = btrim(target_reason)
    where grant_record.id = target_grant_id
    returning grant_record.* into existing_grant;

    perform private.append_audit_event(
      target_tenant_id,
      'tenant_admin',
      target_revoked_by,
      'support_access.revoked',
      btrim(target_reason),
      target_correlation_id,
      'support_access',
      target_grant_id
    );
  end if;

  return query
  select
    existing_grant.id,
    existing_grant.support_user_id,
    existing_grant.reason,
    existing_grant.granted_at,
    existing_grant.expires_at,
    existing_grant.revoked_at,
    'revoked'::text;
end;
$$;

create or replace function private.list_support_access(
  target_tenant_id uuid,
  target_requester_id uuid
)
returns table (
  id uuid,
  support_user_id uuid,
  reason text,
  granted_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  status text
)
language plpgsql
stable
security definer
set search_path = ''
set row_security = off
as $$
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

  return query
  select
    grant_record.id,
    grant_record.support_user_id,
    grant_record.reason,
    grant_record.granted_at,
    grant_record.expires_at,
    grant_record.revoked_at,
    case
      when grant_record.revoked_at is not null then 'revoked'
      when grant_record.expires_at <= statement_timestamp() then 'expired'
      else 'active'
    end::text
  from private.support_access_grants grant_record
  where grant_record.tenant_id = target_tenant_id
  order by grant_record.granted_at desc;
end;
$$;

create or replace function private.resolve_active_support_access(
  target_tenant_id uuid,
  target_support_user_id uuid
)
returns table (grant_id uuid, expires_at timestamptz)
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select grant_record.id, grant_record.expires_at
  from private.support_access_grants grant_record
  where grant_record.tenant_id = target_tenant_id
    and grant_record.support_user_id = target_support_user_id
    and grant_record.revoked_at is null
    and grant_record.expires_at > statement_timestamp()
  limit 1;
$$;

revoke all on function private.grant_support_access(uuid, uuid, uuid, text, integer, text)
from public, anon, authenticated;
revoke all on function private.revoke_support_access(uuid, uuid, uuid, text, text)
from public, anon, authenticated;
revoke all on function private.list_support_access(uuid, uuid)
from public, anon, authenticated;
revoke all on function private.resolve_active_support_access(uuid, uuid)
from public, anon, authenticated;

grant execute on function private.grant_support_access(uuid, uuid, uuid, text, integer, text)
to authenticator;
grant execute on function private.revoke_support_access(uuid, uuid, uuid, text, text)
to authenticator;
grant execute on function private.list_support_access(uuid, uuid)
to authenticator;
grant execute on function private.resolve_active_support_access(uuid, uuid)
to authenticator;

commit;
