begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(9);

insert into public.tenants (id, slug, name, status)
values (
  'a9000000-0000-4000-8000-000000000009',
  'audit-events',
  'Audit Events',
  'active'
);

select has_table(
  'private',
  'audit_events',
  'sensitive actions have an append-only audit table'
);
select table_privs_are(
  'private',
  'audit_events',
  'authenticator',
  array[]::text[],
  'the API runtime cannot read or mutate the audit table directly'
);
select ok(
  has_function_privilege(
    'authenticator',
    'private.append_audit_event(uuid,text,uuid,text,text,text,text,uuid)',
    'EXECUTE'
  ),
  'the API runtime can append through the bounded function'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'private.append_audit_event(uuid,text,uuid,text,text,text,text,uuid)',
    'EXECUTE'
  ),
  'browser identities cannot append audit events directly'
);

select ok(
  private.append_audit_event(
    'a9000000-0000-4000-8000-000000000009',
    'platform_superadmin',
    'a9100000-0000-4000-8000-000000000019',
    'tenant.suspension_requested',
    'Incumplimiento comercial confirmado',
    'request-audit-001',
    'tenant',
    'a9000000-0000-4000-8000-000000000009'
  ) > 0,
  'the bounded function appends and returns the event id'
);
select results_eq(
  $$
    select
      actor_type,
      action,
      reason,
      correlation_id,
      subject_type,
      subject_id
    from private.audit_events
    where tenant_id = 'a9000000-0000-4000-8000-000000000009'
  $$,
  $$ values (
    'platform_superadmin'::text,
    'tenant.suspension_requested'::text,
    'Incumplimiento comercial confirmado'::text,
    'request-audit-001'::text,
    'tenant'::text,
    'a9000000-0000-4000-8000-000000000009'::uuid
  ) $$,
  'the event preserves actor, tenant, reason, correlation and subject'
);
select throws_ok(
  $$
    select private.append_audit_event(
      'a9000000-0000-4000-8000-000000000009',
      'platform_superadmin',
      'a9100000-0000-4000-8000-000000000019',
      'tenant.suspended',
      'Motivo válido',
      E'bad\ncorrelation',
      null,
      null
    )
  $$,
  '23514',
  null,
  'unsafe correlation identifiers are rejected'
);
select throws_ok(
  $$
    select private.append_audit_event(
      'a9000000-0000-4000-8000-000000000009',
      'platform_superadmin',
      'a9100000-0000-4000-8000-000000000019',
      'tenant.suspended',
      'no',
      'request-audit-002',
      null,
      null
    )
  $$,
  '23514',
  null,
  'unusable audit reasons are rejected'
);
select throws_ok(
  $$
    select private.append_audit_event(
      'a9000000-0000-4000-8000-000000000009',
      'platform_superadmin',
      'a9100000-0000-4000-8000-000000000019',
      'tenant.suspended',
      'Motivo válido',
      'request-audit-003',
      'tenant',
      null
    )
  $$,
  '23514',
  null,
  'partial subject references are rejected'
);

select * from finish();
rollback;
