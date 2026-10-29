begin;

-- Publicar el negocio dejaba al tenant en `draft`: la resolución por dominio exige un tenant
-- `active`, así que los clientes seguían viendo «Local no disponible» en el QR y la carta pública
-- aun con el negocio publicado. La publicación es el momento en que el negocio pasa a `active`.
-- Sólo sale de `draft`: un tenant suspendido no se reactiva por publicar.
create or replace function private.activate_tenant_on_publication()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
begin
  update public.tenants tenant
  set status = 'active'
  where tenant.id = new.tenant_id
    and tenant.status = 'draft';
  return null;
end;
$$;

revoke all on function private.activate_tenant_on_publication()
from public, anon, authenticated;

drop trigger if exists location_publications_activate_tenant
on private.location_publications;

create trigger location_publications_activate_tenant
after insert on private.location_publications
for each row
execute function private.activate_tenant_on_publication();

-- Negocios ya publicados que quedaron en `draft` antes de esta corrección.
update public.tenants tenant
set status = 'active'
where tenant.status = 'draft'
  and exists (
    select 1
    from private.location_publications publication
    where publication.tenant_id = tenant.id
  );

commit;
