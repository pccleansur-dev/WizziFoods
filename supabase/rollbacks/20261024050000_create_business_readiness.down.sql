begin;

drop function if exists private.publish_location(uuid, uuid, uuid);
drop function if exists private.get_location_readiness(uuid, uuid, uuid);
drop function if exists private.location_readiness(uuid, uuid);

drop table if exists private.location_publications;
drop function if exists private.catalog_covers_languages(jsonb, text[]);

commit;
