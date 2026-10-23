begin;

drop function if exists private.set_catalog_product_availability(
  uuid, uuid, uuid, uuid, boolean, integer
);
drop function if exists private.publish_catalog(uuid, uuid, uuid, integer);
drop function if exists private.save_catalog_draft(uuid, uuid, uuid, jsonb);
drop function if exists private.require_catalog_admin(uuid, uuid, uuid);
drop function if exists private.catalog_snapshot_is_valid(jsonb);

drop table if exists private.catalog_product_availability;
drop table if exists private.published_catalogs;
drop table if exists private.catalog_drafts;

commit;
