begin;

drop function if exists private.resolve_tenant_by_hostname(text);
drop table if exists public.tenant_domains;

commit;
