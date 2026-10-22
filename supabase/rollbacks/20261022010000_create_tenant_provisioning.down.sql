begin;

drop function if exists private.complete_tenant_provisioning(uuid, uuid, uuid);
drop function if exists private.begin_tenant_provisioning(
  uuid, text, text, text, text, text
);
drop table if exists private.tenant_provisioning_requests;

commit;
