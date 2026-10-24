begin;

drop function if exists private.ack_catalog_import_job(bigint);
drop function if exists private.discard_catalog_import(uuid, uuid, uuid, uuid);
drop function if exists private.approve_catalog_import(uuid, uuid, uuid, uuid, jsonb);
drop function if exists private.fail_catalog_import(uuid, uuid, uuid);
drop function if exists private.complete_catalog_import(uuid, uuid, uuid, jsonb);
drop function if exists private.claim_catalog_import(uuid, uuid, uuid);
drop function if exists private.read_catalog_import_job(integer);
drop function if exists private.get_catalog_import(uuid, uuid, uuid, uuid);
drop function if exists private.list_catalog_imports(uuid, uuid, uuid);
drop function if exists private.enqueue_catalog_import(uuid, uuid, uuid, uuid, text, jsonb);
drop function if exists private.assert_catalog_import_admin(uuid, uuid, uuid);
drop table if exists private.catalog_imports;
select pgmq.drop_queue('catalog_import_processing');

commit;
