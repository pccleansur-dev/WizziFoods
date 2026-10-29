begin;

drop trigger if exists location_publications_activate_tenant
on private.location_publications;

drop function if exists private.activate_tenant_on_publication();

commit;
