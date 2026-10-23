begin;

drop function if exists private.fail_business_media_asset(uuid, uuid);
drop function if exists private.complete_business_media_asset(
  uuid, uuid, bigint, integer, integer, text
);
drop function if exists private.reserve_business_media_asset(
  uuid, uuid, uuid, text, text, bigint
);
drop table if exists private.business_media_assets;

-- Supabase protege los buckets contra borrado SQL directo. El bucket privado
-- vacío se conserva y la migración de avance vuelve a validar su configuración.

commit;
