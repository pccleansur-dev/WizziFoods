begin;

create or replace function private.list_platform_tenants(
  target_requester_id uuid
)
returns table (
  tenant_id uuid,
  name text,
  slug text,
  status text,
  primary_hostname text,
  suspension_mode text,
  suspension_phase text,
  suspension_requested_at timestamptz
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
    from public.platform_superadmins superadmin
    where superadmin.user_id = target_requester_id
  ) then
    raise exception 'platform superadministrator authorization required'
      using errcode = '42501';
  end if;

  return query
  select
    tenant.id,
    tenant.name,
    tenant.slug,
    tenant.status,
    domain.hostname,
    suspension.mode,
    suspension.phase,
    suspension.requested_at
  from public.tenants tenant
  left join public.tenant_domains domain
    on domain.tenant_id = tenant.id
    and domain.is_primary
  left join private.tenant_suspensions suspension
    on suspension.tenant_id = tenant.id
  order by tenant.created_at desc, tenant.id;
end;
$$;

create or replace function private.list_platform_audit_events(
  target_requester_id uuid,
  target_limit integer
)
returns table (
  event_id bigint,
  tenant_id uuid,
  tenant_name text,
  actor_type text,
  actor_id uuid,
  action text,
  reason text,
  correlation_id text,
  occurred_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
set row_security = off
as $$
begin
  if target_limit < 1 or target_limit > 100 then
    raise exception 'audit event limit must be between 1 and 100'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.platform_superadmins superadmin
    where superadmin.user_id = target_requester_id
  ) then
    raise exception 'platform superadministrator authorization required'
      using errcode = '42501';
  end if;

  return query
  select
    event.id,
    event.tenant_id,
    tenant.name,
    event.actor_type,
    event.actor_id,
    event.action,
    event.reason,
    event.correlation_id,
    event.occurred_at
  from private.audit_events event
  inner join public.tenants tenant on tenant.id = event.tenant_id
  order by event.occurred_at desc, event.id desc
  limit target_limit;
end;
$$;

revoke all on function private.list_platform_tenants(uuid)
from public, anon, authenticated;
revoke all on function private.list_platform_audit_events(uuid, integer)
from public, anon, authenticated;

grant execute on function private.list_platform_tenants(uuid)
to authenticator;
grant execute on function private.list_platform_audit_events(uuid, integer)
to authenticator;

commit;
