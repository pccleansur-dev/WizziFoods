begin;

create table private.audit_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  actor_type text not null check (
    actor_type in (
      'platform_superadmin',
      'tenant_admin',
      'staff',
      'support'
    )
  ),
  actor_id uuid not null,
  action text not null check (
    action ~ '^[a-z][a-z0-9_.]{2,79}$'
  ),
  reason text not null check (
    reason = btrim(reason)
    and length(reason) between 3 and 500
  ),
  correlation_id text not null check (
    length(correlation_id) between 1 and 128
    and correlation_id ~ '^[A-Za-z0-9._:-]+$'
  ),
  subject_type text check (
    subject_type is null
    or subject_type ~ '^[a-z][a-z0-9_]{1,49}$'
  ),
  subject_id uuid,
  occurred_at timestamptz not null default now(),
  check ((subject_type is null) = (subject_id is null))
);

create index audit_events_tenant_occurred_idx
  on private.audit_events (tenant_id, occurred_at desc, id desc);

revoke all on table private.audit_events from public, anon, authenticated, authenticator;
revoke all on sequence private.audit_events_id_seq from public, anon, authenticated, authenticator;

create or replace function private.append_audit_event(
  target_tenant_id uuid,
  target_actor_type text,
  target_actor_id uuid,
  target_action text,
  target_reason text,
  target_correlation_id text,
  target_subject_type text,
  target_subject_id uuid
)
returns bigint
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  event_id bigint;
begin
  insert into private.audit_events (
    tenant_id,
    actor_type,
    actor_id,
    action,
    reason,
    correlation_id,
    subject_type,
    subject_id
  ) values (
    target_tenant_id,
    target_actor_type,
    target_actor_id,
    target_action,
    target_reason,
    target_correlation_id,
    target_subject_type,
    target_subject_id
  )
  returning id into event_id;

  return event_id;
end;
$$;

revoke all on function private.append_audit_event(
  uuid,
  text,
  uuid,
  text,
  text,
  text,
  text,
  uuid
) from public, anon, authenticated;
grant execute on function private.append_audit_event(
  uuid,
  text,
  uuid,
  text,
  text,
  text,
  text,
  uuid
) to authenticator;

commit;
