begin;

drop function if exists private.get_current_catalog(uuid, uuid);
drop function if exists private.get_catalog_draft(uuid, uuid, uuid);

commit;
