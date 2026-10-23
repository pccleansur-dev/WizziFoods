begin;

create function private.resolve_tenant_admin_by_hostname(
  target_hostname text,
  target_requester_id uuid
)
returns table (
  domain_id uuid,
  hostname text,
  tenant_id uuid,
  tenant_slug text,
  tenant_name text,
  location_id uuid,
  location_name text
)
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select
    domain.id,
    domain.hostname,
    tenant.id,
    tenant.slug,
    tenant.name,
    location.id,
    location.name
  from public.tenant_domains domain
  inner join public.tenants tenant on tenant.id = domain.tenant_id
  inner join public.locations location
    on location.tenant_id = tenant.id and location.is_primary
  inner join public.tenant_memberships membership
    on membership.tenant_id = tenant.id
      and membership.user_id = target_requester_id
      and membership.role = 'admin'
  where domain.hostname = target_hostname
    and domain.status = 'active'
    and tenant.status in ('draft', 'active', 'suspended')
  limit 1;
$$;

revoke all on function private.resolve_tenant_admin_by_hostname(text, uuid)
from public, anon, authenticated;
grant execute on function private.resolve_tenant_admin_by_hostname(text, uuid)
to authenticator;

commit;
