begin;

create table private.tenant_suspensions (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  mode text not null check (mode in ('commercial', 'security')),
  phase text not null check (phase in ('commercial_draining', 'suspended')),
  reason text not null check (
    reason = btrim(reason)
    and length(reason) between 3 and 500
  ),
  requested_by uuid not null references public.platform_superadmins(user_id) on delete restrict,
  correlation_id text not null check (
    length(correlation_id) between 1 and 128
    and correlation_id ~ '^[A-Za-z0-9._:-]+$'
  ),
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  check (
    (mode = 'commercial' and phase = 'commercial_draining' and completed_at is null)
    or (phase = 'suspended' and completed_at is not null)
  )
);

revoke all on table private.tenant_suspensions
from public, anon, authenticated, authenticator;

create or replace function private.can_open_table_session(
  target_tenant_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select exists (
    select 1
    from public.tenants tenant
    where tenant.id = target_tenant_id
      and tenant.status = 'active'
      and not exists (
        select 1
        from private.tenant_suspensions suspension
        where suspension.tenant_id = tenant.id
          and suspension.phase in ('commercial_draining', 'suspended')
      )
  );
$$;

create or replace function private.request_tenant_suspension(
  target_tenant_id uuid,
  target_requested_by uuid,
  target_mode text,
  target_reason text,
  target_correlation_id text
)
returns table (
  mode text,
  phase text,
  tenant_status text,
  requested_at timestamptz,
  completed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  requested_at_value timestamptz := statement_timestamp();
  tenant_status_value text;
  should_complete_immediately boolean;
begin
  if target_mode not in ('commercial', 'security') then
    raise exception 'unsupported tenant suspension mode'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.platform_superadmins superadmin
    where superadmin.user_id = target_requested_by
  ) then
    raise exception 'platform superadministrator authorization required'
      using errcode = '42501';
  end if;

  select tenant.status
  into tenant_status_value
  from public.tenants tenant
  where tenant.id = target_tenant_id
  for update;

  if not found then
    raise exception 'tenant was not found'
      using errcode = '22023';
  end if;

  if tenant_status_value = 'suspended' and not exists (
    select 1
    from private.tenant_suspensions suspension
    where suspension.tenant_id = target_tenant_id
  ) then
    raise exception 'tenant is already suspended outside the managed suspension flow'
      using errcode = '22023';
  end if;

  if target_mode = 'commercial' and exists (
    select 1
    from private.tenant_suspensions suspension
    where suspension.tenant_id = target_tenant_id
      and suspension.phase = 'suspended'
  ) then
    raise exception 'a terminal tenant suspension cannot return to draining'
      using errcode = '22023';
  end if;

  should_complete_immediately :=
    target_mode = 'security' or tenant_status_value = 'draft';

  insert into private.tenant_suspensions (
    tenant_id,
    mode,
    phase,
    reason,
    requested_by,
    correlation_id,
    requested_at,
    completed_at
  ) values (
    target_tenant_id,
    target_mode,
    case
      when should_complete_immediately then 'suspended'
      else 'commercial_draining'
    end,
    btrim(target_reason),
    target_requested_by,
    target_correlation_id,
    requested_at_value,
    case
      when should_complete_immediately then requested_at_value
      else null
    end
  )
  on conflict (tenant_id) do update
  set
    mode = excluded.mode,
    phase = excluded.phase,
    reason = excluded.reason,
    requested_by = excluded.requested_by,
    correlation_id = excluded.correlation_id,
    requested_at = excluded.requested_at,
    completed_at = excluded.completed_at;

  if should_complete_immediately then
    update public.tenants tenant
    set
      status = 'suspended',
      updated_at = requested_at_value
    where tenant.id = target_tenant_id;

    if target_mode = 'security' then
      update private.staff_sessions session
      set revoked_at = requested_at_value
      where session.tenant_id = target_tenant_id
        and session.revoked_at is null;
    end if;

    tenant_status_value := 'suspended';
  else
    update public.tenants tenant
    set
      status = 'active',
      updated_at = requested_at_value
    where tenant.id = target_tenant_id;

    tenant_status_value := 'active';
  end if;

  perform private.append_audit_event(
    target_tenant_id,
    'platform_superadmin',
    target_requested_by,
    'tenant.suspension_requested',
    btrim(target_reason),
    target_correlation_id,
    'tenant',
    target_tenant_id
  );

  if target_mode = 'commercial' and should_complete_immediately then
    perform private.append_audit_event(
      target_tenant_id,
      'platform_superadmin',
      target_requested_by,
      'tenant.suspension_completed',
      btrim(target_reason),
      target_correlation_id,
      'tenant',
      target_tenant_id
    );
  end if;

  return query
  select
    suspension.mode,
    suspension.phase,
    tenant_status_value,
    suspension.requested_at,
    suspension.completed_at
  from private.tenant_suspensions suspension
  where suspension.tenant_id = target_tenant_id;
end;
$$;

create or replace function private.complete_commercial_suspension(
  target_tenant_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  suspension_record private.tenant_suspensions%rowtype;
  completed_at_value timestamptz := statement_timestamp();
begin
  select suspension.*
  into suspension_record
  from private.tenant_suspensions suspension
  where suspension.tenant_id = target_tenant_id
  for update;

  if not found
    or suspension_record.mode <> 'commercial'
    or suspension_record.phase <> 'commercial_draining'
  then
    raise exception 'tenant does not have a commercial suspension awaiting completion'
      using errcode = '22023';
  end if;

  update private.tenant_suspensions suspension
  set
    phase = 'suspended',
    completed_at = completed_at_value
  where suspension.tenant_id = target_tenant_id;

  update public.tenants tenant
  set
    status = 'suspended',
    updated_at = completed_at_value
  where tenant.id = target_tenant_id;

  perform private.append_audit_event(
    target_tenant_id,
    'platform_superadmin',
    suspension_record.requested_by,
    'tenant.suspension_completed',
    suspension_record.reason,
    suspension_record.correlation_id,
    'tenant',
    target_tenant_id
  );
end;
$$;

revoke all on function private.can_open_table_session(uuid)
from public, anon, authenticated;
revoke all on function private.request_tenant_suspension(uuid, uuid, text, text, text)
from public, anon, authenticated;
revoke all on function private.complete_commercial_suspension(uuid)
from public, anon, authenticated, authenticator;

grant execute on function private.can_open_table_session(uuid)
to authenticator;
grant execute on function private.request_tenant_suspension(uuid, uuid, text, text, text)
to authenticator;

commit;
