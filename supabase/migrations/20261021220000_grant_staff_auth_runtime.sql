begin;

grant usage on schema private to authenticator;
grant select, insert, update on table private.staff_credentials to authenticator;
grant select, insert, update on table private.staff_sessions to authenticator;
grant insert on table private.staff_auth_events to authenticator;
grant usage, select on sequence private.staff_auth_events_id_seq to authenticator;

create or replace function private.resolve_active_staff_tenant(
  target_tenant_slug text
)
returns table (id uuid, name text, slug text)
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select tenant.id, tenant.name, tenant.slug
  from public.tenants tenant
  where tenant.slug = target_tenant_slug
    and tenant.status = 'active'
  limit 1;
$$;

create or replace function private.lock_staff_login_candidate(
  target_tenant_id uuid,
  target_username text
)
returns table (
  staff_member_id uuid,
  display_name text,
  role text,
  is_active boolean,
  location_id uuid,
  location_name text,
  pin_hash text,
  failed_attempts smallint,
  locked_until timestamptz
)
language sql
volatile
security definer
set search_path = ''
set row_security = off
as $$
  select
    member.id,
    member.display_name,
    member.role,
    member.is_active,
    location.id,
    location.name,
    credential.pin_hash,
    credential.failed_attempts,
    credential.locked_until
  from public.staff_members member
  inner join public.locations location
    on location.tenant_id = member.tenant_id
    and location.id = member.location_id
  inner join private.staff_credentials credential
    on credential.staff_member_id = member.id
  where member.tenant_id = target_tenant_id
    and member.username = target_username
  limit 1
  for update of credential;
$$;

create or replace function private.resolve_staff_session(target_token_hash text)
returns table (
  session_id uuid,
  tenant_id uuid,
  tenant_name text,
  tenant_slug text,
  tenant_status text,
  staff_member_id uuid,
  display_name text,
  role text,
  is_active boolean,
  location_id uuid,
  location_name text,
  last_revalidated_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz
)
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select
    session.id,
    tenant.id,
    tenant.name,
    tenant.slug,
    tenant.status,
    member.id,
    member.display_name,
    member.role,
    member.is_active,
    location.id,
    location.name,
    session.last_revalidated_at,
    session.expires_at,
    session.revoked_at
  from private.staff_sessions session
  inner join public.tenants tenant on tenant.id = session.tenant_id
  inner join public.staff_members member on member.id = session.staff_member_id
  inner join public.locations location on location.id = member.location_id
  where session.token_hash = target_token_hash
  limit 1;
$$;

create or replace function private.lock_staff_revalidation_candidate(
  target_token_hash text
)
returns table (
  session_id uuid,
  tenant_id uuid,
  staff_member_id uuid,
  role text,
  is_active boolean,
  expires_at timestamptz,
  revoked_at timestamptz,
  pin_hash text,
  failed_attempts smallint,
  locked_until timestamptz
)
language sql
volatile
security definer
set search_path = ''
set row_security = off
as $$
  select
    session.id,
    session.tenant_id,
    member.id,
    member.role,
    member.is_active,
    session.expires_at,
    session.revoked_at,
    credential.pin_hash,
    credential.failed_attempts,
    credential.locked_until
  from private.staff_sessions session
  inner join public.staff_members member on member.id = session.staff_member_id
  inner join private.staff_credentials credential
    on credential.staff_member_id = member.id
  where session.token_hash = target_token_hash
  limit 1
  for update of session, credential;
$$;

revoke all on function private.resolve_active_staff_tenant(text)
from public, anon, authenticated;
revoke all on function private.lock_staff_login_candidate(uuid, text)
from public, anon, authenticated;
revoke all on function private.resolve_staff_session(text)
from public, anon, authenticated;
revoke all on function private.lock_staff_revalidation_candidate(text)
from public, anon, authenticated;
grant execute on function private.resolve_active_staff_tenant(text)
to authenticator;
grant execute on function private.lock_staff_login_candidate(uuid, text)
to authenticator;
grant execute on function private.resolve_staff_session(text)
to authenticator;
grant execute on function private.lock_staff_revalidation_candidate(text)
to authenticator;

commit;
