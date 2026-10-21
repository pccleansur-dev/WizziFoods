begin;

drop table if exists public.tenant_memberships;
drop table if exists public.locations;
drop table if exists public.tenants;
drop function if exists private.is_tenant_member(uuid);
drop function if exists private.create_initial_location();
drop schema if exists private;

commit;
