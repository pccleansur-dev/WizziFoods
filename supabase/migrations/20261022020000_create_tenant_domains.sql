begin;

create table public.tenant_domains (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  hostname text not null unique check (
    hostname = lower(btrim(hostname))
    and length(hostname) between 1 and 253
    and hostname ~ '^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'
  ),
  kind text not null check (kind in ('platform_subdomain', 'custom')),
  status text not null default 'pending_verification' check (
    status in ('pending_verification', 'active', 'disabled')
  ),
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, hostname)
);

create unique index tenant_domains_one_primary_per_tenant
  on public.tenant_domains (tenant_id)
  where is_primary;

create index tenant_domains_tenant_id_idx
  on public.tenant_domains (tenant_id);

alter table public.tenant_domains enable row level security;
alter table public.tenant_domains force row level security;

revoke all on table public.tenant_domains from anon, authenticated;
grant select on table public.tenant_domains to authenticated;

create policy tenant_domains_select_member
on public.tenant_domains
for select
to authenticated
using ((select private.is_tenant_member(tenant_id)));

create function private.resolve_tenant_by_hostname(target_hostname text)
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
  where domain.hostname = target_hostname
    and domain.status = 'active'
    and tenant.status = 'active'
  limit 1;
$$;

revoke all on function private.resolve_tenant_by_hostname(text)
from public, anon, authenticated;
grant usage on schema private to authenticator;
grant execute on function private.resolve_tenant_by_hostname(text)
to authenticator;

commit;
