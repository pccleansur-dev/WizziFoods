begin;

-- Destructive: drops the join/separation history. Groups, sessions and the ledger
-- stay exactly as they are; no account is moved back and no table changes state.
drop function private.separate_tables(uuid, uuid, uuid, uuid, uuid, uuid);
drop function private.join_tables(uuid, uuid, uuid, uuid, uuid[], text);
drop function private.table_group_tables(uuid, uuid, uuid[]);

drop trigger floor_plans_guard_groups_vs_sessions on private.floor_plans;
drop function private.guard_plan_groups_vs_sessions();

-- The T22 guard: a session is only ever closed.
create or replace function private.guard_table_session_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  movable constant text[] := array['status', 'closed_at'];
begin
  if tg_op <> 'UPDATE'
    or old.status <> 'open'
    or new.status <> 'closed'
    or (to_jsonb(new) - movable) is distinct from (to_jsonb(old) - movable)
  then
    raise exception 'a table session is never deleted or rewritten' using errcode = 'PT209';
  end if;
  return new;
end;
$$;

-- The T22 session opening, without the shared lock.
create or replace function private.ensure_table_session(
  target_tenant_id uuid,
  target_location_id uuid,
  target_table_id uuid,
  target_staff_id uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
declare
  target_group uuid;
  scope uuid;
  session_id uuid;
begin
  select membership.group_id into target_group
  from private.floor_group_members membership
  where membership.tenant_id = target_tenant_id
    and membership.location_id = target_location_id
    and membership.table_id = target_table_id;
  scope := coalesce(target_group, target_table_id);

  select account_session.id into session_id
  from private.table_sessions account_session
  where account_session.tenant_id = target_tenant_id
    and account_session.location_id = target_location_id
    and account_session.scope_key = scope
    and account_session.status = 'open';
  if session_id is null then
    insert into private.table_sessions (
      tenant_id, location_id, scope_key, table_id, group_id, opened_by
    ) values (
      target_tenant_id, target_location_id, scope, target_table_id,
      target_group, target_staff_id
    )
    on conflict (tenant_id, location_id, scope_key) where status = 'open'
    do nothing
    returning id into session_id;
    if session_id is null then
      select account_session.id into session_id
      from private.table_sessions account_session
      where account_session.tenant_id = target_tenant_id
        and account_session.location_id = target_location_id
        and account_session.scope_key = scope
        and account_session.status = 'open';
    end if;
  end if;

  insert into private.floor_table_service_states (
    tenant_id, location_id, table_id, state
  ) values (
    target_tenant_id, target_location_id, target_table_id, 'occupied'
  )
  on conflict (tenant_id, location_id, table_id)
  do update set state = 'occupied', updated_at = now();
  return session_id;
end;
$$;

drop function private.table_groups_lock_key(uuid, uuid);
drop table private.table_group_events;

commit;
