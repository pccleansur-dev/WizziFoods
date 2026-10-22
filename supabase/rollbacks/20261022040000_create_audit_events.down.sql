begin;

drop function if exists private.append_audit_event(
  uuid,
  text,
  uuid,
  text,
  text,
  text,
  text,
  uuid
);
drop table if exists private.audit_events;

commit;
