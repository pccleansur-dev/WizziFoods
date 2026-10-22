begin;

drop function if exists private.complete_tenant_provisioning_with_domain(
  uuid, uuid, uuid
);
drop function if exists private.begin_tenant_provisioning_with_domain(
  uuid, text, text, text, text, text, text
);

commit;
