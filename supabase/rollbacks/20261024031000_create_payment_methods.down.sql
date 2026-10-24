begin;

drop function if exists private.payment_readiness(uuid, uuid);
drop function if exists private.clear_payment_secret(uuid, uuid, uuid, text);
drop function if exists private.store_payment_secret(uuid, uuid, uuid, text, bytea, smallint);
drop function if exists private.update_payment_method(uuid, uuid, uuid, text, boolean, jsonb);
drop function if exists private.read_payment_methods(uuid, uuid, uuid);
drop function if exists private.payment_methods_view(uuid, uuid);
drop function if exists private.lock_payment_methods(uuid, uuid, uuid);
drop function if exists private.ensure_payment_methods(uuid, uuid);

drop table if exists private.payment_method_secrets;
drop table if exists private.payment_methods;

drop function if exists private.payment_methods_require_available();
drop function if exists private.payment_available_count(uuid, uuid);
drop function if exists private.payment_method_available(uuid, uuid, text, boolean, jsonb);

commit;
