begin;

create table public.staff_members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  location_id uuid not null,
  username text not null,
  display_name text not null,
  role text not null check (role in ('manager', 'waiter', 'kitchen', 'bar')),
  is_active boolean not null default true,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, username),
  foreign key (tenant_id, location_id)
    references public.locations(tenant_id, id)
    on delete restrict,
  check (username = lower(btrim(username))),
  check (username ~ '^[a-z0-9](?:[a-z0-9._-]{1,62}[a-z0-9])?$'),
  check (length(btrim(display_name)) between 1 and 120)
);

create index staff_members_tenant_location_idx
  on public.staff_members (tenant_id, location_id);

create table private.staff_credentials (
  staff_member_id uuid primary key references public.staff_members(id) on delete cascade,
  pin_hash text not null check (pin_hash like 'scrypt-v1$%'),
  failed_attempts smallint not null default 0
    check (failed_attempts between 0 and 5),
  locked_until timestamptz,
  pin_changed_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table private.staff_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  staff_member_id uuid not null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  last_revalidated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  foreign key (tenant_id, staff_member_id)
    references public.staff_members(tenant_id, id)
    on delete cascade,
  check (expires_at > created_at),
  check (last_revalidated_at >= created_at)
);

create index staff_sessions_active_lookup_idx
  on private.staff_sessions (token_hash, expires_at)
  where revoked_at is null;

create table private.staff_auth_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  staff_member_id uuid references public.staff_members(id) on delete set null,
  event_type text not null check (
    event_type in (
      'login_succeeded',
      'login_failed',
      'account_locked',
      'session_expired',
      'session_revoked',
      'pin_revalidated'
    )
  ),
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  check (jsonb_typeof(metadata) = 'object')
);

create index staff_auth_events_tenant_occurred_idx
  on private.staff_auth_events (tenant_id, occurred_at desc);

alter table public.staff_members enable row level security;
alter table public.staff_members force row level security;

revoke all on table public.staff_members from anon, authenticated;
revoke all on table private.staff_credentials from public, anon, authenticated;
revoke all on table private.staff_sessions from public, anon, authenticated;
revoke all on table private.staff_auth_events from public, anon, authenticated;

grant select, insert on table public.staff_members to authenticated;
grant update (display_name, role, is_active, location_id, updated_at)
on table public.staff_members to authenticated;

create policy staff_members_select_tenant_admin
on public.staff_members
for select
to authenticated
using ((select private.is_tenant_member(tenant_id)));

create policy staff_members_insert_tenant_admin
on public.staff_members
for insert
to authenticated
with check (
  (select private.is_tenant_member(tenant_id))
  and created_by = (select auth.uid())
);

create policy staff_members_update_tenant_admin
on public.staff_members
for update
to authenticated
using ((select private.is_tenant_member(tenant_id)))
with check ((select private.is_tenant_member(tenant_id)));

commit;
