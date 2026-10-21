begin;

create table public.platform_superadmins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.platform_superadmins enable row level security;
alter table public.platform_superadmins force row level security;

revoke all on table public.platform_superadmins from anon, authenticated;
grant select on table public.platform_superadmins to authenticated;

create policy platform_superadmins_select_self
on public.platform_superadmins
for select
to authenticated
using ((select auth.uid()) is not null and user_id = (select auth.uid()));

commit;
