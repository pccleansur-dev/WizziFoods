begin;

create function private.resolve_sole_tenant_admin(target_requester_id uuid)
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
  with candidates as (
    select
      domain.id as domain_id,
      domain.hostname,
      tenant.id as tenant_id,
      tenant.slug as tenant_slug,
      tenant.name as tenant_name,
      location.id as location_id,
      location.name as location_name,
      count(*) over () as candidate_count
    from public.tenant_memberships membership
    inner join public.tenants tenant on tenant.id = membership.tenant_id
    inner join public.locations location
      on location.tenant_id = tenant.id and location.is_primary
    inner join public.tenant_domains domain
      on domain.tenant_id = tenant.id
        and domain.is_primary
        and domain.status = 'active'
    where membership.user_id = target_requester_id
      and membership.role = 'admin'
      and tenant.status in ('draft', 'active', 'suspended')
  )
  select
    domain_id,
    hostname,
    tenant_id,
    tenant_slug,
    tenant_name,
    location_id,
    location_name
  from candidates
  where candidate_count = 1;
$$;

revoke all on function private.resolve_sole_tenant_admin(uuid)
from public, anon, authenticated;
grant execute on function private.resolve_sole_tenant_admin(uuid)
to authenticator;

commit;
