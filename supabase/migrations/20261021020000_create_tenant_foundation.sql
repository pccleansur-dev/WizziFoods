begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null check (length(btrim(name)) between 1 and 120),
  status text not null default 'draft' check (status in ('draft', 'active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  timezone text not null default 'America/Argentina/Buenos_Aires',
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);

create unique index locations_one_primary_per_tenant
  on public.locations (tenant_id)
  where is_primary;

create index locations_tenant_id_idx on public.locations (tenant_id);

create table public.tenant_memberships (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('admin')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

create index tenant_memberships_user_id_idx
  on public.tenant_memberships (user_id);

create or replace function private.create_initial_location()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.locations (tenant_id, name, is_primary)
  values (new.id, 'Principal', true);
  return new;
end;
$$;

revoke all on function private.create_initial_location() from public, anon, authenticated;

create trigger tenants_create_initial_location
after insert on public.tenants
for each row execute function private.create_initial_location();

create or replace function private.is_tenant_member(target_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select exists (
    select 1
    from public.tenant_memberships membership
    where membership.tenant_id = target_tenant_id
      and membership.user_id = (select auth.uid())
  );
$$;

revoke all on function private.is_tenant_member(uuid) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.is_tenant_member(uuid) to authenticated;

alter table public.tenants enable row level security;
alter table public.tenants force row level security;
alter table public.locations enable row level security;
alter table public.locations force row level security;
alter table public.tenant_memberships enable row level security;
alter table public.tenant_memberships force row level security;

revoke all on table public.tenants from anon, authenticated;
revoke all on table public.locations from anon, authenticated;
revoke all on table public.tenant_memberships from anon, authenticated;

grant select on table public.tenants to authenticated;
grant update (name) on table public.tenants to authenticated;
grant select, insert, delete on table public.locations to authenticated;
grant update (name, timezone) on table public.locations to authenticated;
grant select on table public.tenant_memberships to authenticated;

create policy tenants_select_member
on public.tenants
for select
to authenticated
using ((select private.is_tenant_member(id)));

create policy tenants_update_member
on public.tenants
for update
to authenticated
using ((select private.is_tenant_member(id)))
with check ((select private.is_tenant_member(id)));

create policy locations_select_member
on public.locations
for select
to authenticated
using ((select private.is_tenant_member(tenant_id)));

create policy locations_insert_member
on public.locations
for insert
to authenticated
with check (
  (select private.is_tenant_member(tenant_id))
  and not is_primary
);

create policy locations_update_member
on public.locations
for update
to authenticated
using ((select private.is_tenant_member(tenant_id)))
with check ((select private.is_tenant_member(tenant_id)));

create policy locations_delete_member
on public.locations
for delete
to authenticated
using (
  (select private.is_tenant_member(tenant_id))
  and not is_primary
);

create policy tenant_memberships_select_self
on public.tenant_memberships
for select
to authenticated
using ((select auth.uid()) is not null and user_id = (select auth.uid()));

commit;
