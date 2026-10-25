begin;

-- Joining and separating tables during service (T27).
--
-- A group is temporary membership of physical tables: every table keeps its id and
-- its QR. While a group has an open account the account follows the group, and when
-- the group is separated the account stays with ONE anchor table. Orders, payments
-- and debt are never moved: the ledger and the confirmed orders are not touched,
-- only the scope of the session (which tables it covers) and the service state of
-- the released tables change.
--
-- Codes: PT277 invalid selection of tables, PT278 two different open accounts
-- cannot be merged, PT279 an anchor table is required (or does not belong to the
-- group), PT280 the floor plan would break the groups of an open account.

-- 1. History -----------------------------------------------------------------------------

create table private.table_group_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  location_id uuid not null,
  kind text not null check (kind in ('joined', 'separated')),
  group_id uuid not null,
  group_name text not null,
  -- The open account that went through the change, if there was one.
  session_id uuid,
  anchor_table_id uuid,
  table_ids uuid[] not null check (cardinality(table_ids) between 1 and 20),
  released_table_ids uuid[] not null default '{}',
  merged_group_ids uuid[] not null default '{}',
  actor_id uuid not null,
  command_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, location_id)
    references public.locations(tenant_id, id) on delete cascade,
  foreign key (tenant_id, location_id, session_id)
    references private.table_sessions(tenant_id, location_id, id) on delete restrict,
  foreign key (tenant_id, actor_id)
    references public.staff_members(tenant_id, id) on delete restrict
);

create index table_group_events_location_idx
  on private.table_group_events (tenant_id, location_id, id);
create index table_group_events_session_idx
  on private.table_group_events (tenant_id, location_id, session_id)
  where session_id is not null;

create trigger table_group_events_append_only
before update or delete on private.table_group_events
for each row execute function private.reject_append_only_change();
create trigger table_group_events_no_truncate
before truncate on private.table_group_events
for each statement execute function private.reject_append_only_change();

revoke all on table private.table_group_events
from public, anon, authenticated, authenticator;

-- 2. One lock for every change of the groups ---------------------------------------------

-- Joining, separating and saving the plan take it exclusively; opening a session
-- takes it shared. A confirmation that raced a change therefore either finishes
-- first or reads the new groups, and a session can never be opened on a stale scope.
create function private.table_groups_lock_key(
  target_tenant_id uuid,
  target_location_id uuid
)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select hashtextextended(
    'table-groups:' || target_tenant_id::text || ':' || target_location_id::text, 0
  );
$$;

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
  perform pg_advisory_xact_lock_shared(
    private.table_groups_lock_key(target_tenant_id, target_location_id)
  );

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

-- 3. A session may only be re-scoped by the two entry points ------------------------------

-- Same guard as before, plus: an OPEN session may change which tables it covers
-- (table_id, group_id, scope_key) while a join or a separation is running. Nothing
-- else about a session is ever rewritten.
create or replace function private.guard_table_session_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  movable constant text[] := array['status', 'closed_at'];
  regroupable constant text[] := array['table_id', 'group_id', 'scope_key'];
begin
  if tg_op = 'UPDATE'
    and old.status = 'open'
    and new.status = 'open'
    and coalesce(current_setting('private.regroup_session', true), 'off') = 'on'
    and (to_jsonb(new) - regroupable) is not distinct from (to_jsonb(old) - regroupable)
  then
    return new;
  end if;
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

-- 4. The floor plan editor cannot break the groups of an open account ----------------------

create function private.guard_plan_groups_vs_sessions()
returns trigger
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
begin
  perform pg_advisory_xact_lock(
    private.table_groups_lock_key(new.tenant_id, new.location_id)
  );
  if exists (
    select 1
    from private.table_sessions account_session
    where account_session.tenant_id = new.tenant_id
      and account_session.location_id = new.location_id
      and account_session.status = 'open'
      and (
        -- A group account whose group lost its table or disappeared.
        (
          account_session.group_id is not null
          and not exists (
            select 1 from private.floor_group_members member
            where member.tenant_id = account_session.tenant_id
              and member.location_id = account_session.location_id
              and member.group_id = account_session.group_id
              and member.table_id = account_session.table_id
          )
        )
        -- A loose account whose table was put into a group.
        or (
          account_session.group_id is null
          and exists (
            select 1 from private.floor_group_members member
            where member.tenant_id = account_session.tenant_id
              and member.location_id = account_session.location_id
              and member.table_id = account_session.table_id
          )
        )
      )
  ) then
    raise exception 'the plan would change the groups of an open account'
      using errcode = 'PT280';
  end if;
  return new;
end;
$$;

create trigger floor_plans_guard_groups_vs_sessions
before update on private.floor_plans
for each row execute function private.guard_plan_groups_vs_sessions();

-- 5. Joining -------------------------------------------------------------------------------

create function private.table_group_tables(
  target_tenant_id uuid,
  target_location_id uuid,
  target_table_ids uuid[]
)
returns jsonb
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'tableId', floor_table.id,
    'label', floor_table.label,
    'state', private.waiter_table_state(
      target_tenant_id, target_location_id, floor_table.id)
  ) order by floor_table.position, floor_table.id), '[]'::jsonb)
  from private.floor_tables floor_table
  where floor_table.tenant_id = target_tenant_id
    and floor_table.location_id = target_location_id
    and floor_table.id = any(target_table_ids);
$$;

create function private.join_tables(
  target_tenant_id uuid,
  target_location_id uuid,
  target_staff_id uuid,
  target_command_id uuid,
  target_table_ids uuid[],
  target_group_name text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_role text := private.waiter_actor_role(
    target_tenant_id, target_location_id, target_staff_id
  );
  stored jsonb;
  requested uuid[];
  clean_name text := nullif(btrim(target_group_name), '');
  touched uuid[];
  absorbed uuid[];
  kept_group uuid;
  kept_name text;
  covered uuid[];
  fresh uuid[];
  floors integer;
  open_sessions uuid[];
  account_id uuid;
  next_position integer;
begin
  if target_table_ids is null then
    raise exception 'choose the tables to join' using errcode = 'PT277';
  end if;
  select coalesce(array_agg(distinct picked order by picked), '{}') into requested
  from unnest(target_table_ids) as picked;
  if cardinality(requested) <> cardinality(target_table_ids)
    or cardinality(requested) < 2
    or cardinality(requested) > 20
    or (clean_name is not null and (
      char_length(clean_name) > 60 or clean_name ~ '[[:cntrl:]]'
    ))
  then
    raise exception 'choose between 2 and 20 different tables' using errcode = 'PT277';
  end if;

  stored := private.claim_waiter_command(
    target_tenant_id, target_location_id, target_staff_id, target_command_id,
    jsonb_build_object(
      'kind', 'join_tables', 'tableIds', to_jsonb(requested), 'name', clean_name
    )
  );
  if stored is not null then
    return stored;
  end if;

  perform pg_advisory_xact_lock(
    private.table_groups_lock_key(target_tenant_id, target_location_id)
  );

  -- Every table must exist and be served by the actor (a manager serves them all).
  if exists (
    select 1 from unnest(requested) as picked
    where not private.waiter_serves_table(
      target_tenant_id, target_location_id, target_staff_id, actor_role, picked
    )
  ) then
    raise exception 'table not found' using errcode = 'PT201';
  end if;

  select coalesce(array_agg(distinct member.group_id), '{}') into touched
  from private.floor_group_members member
  where member.tenant_id = target_tenant_id
    and member.location_id = target_location_id
    and member.table_id = any(requested);

  select coalesce(array_agg(distinct member.table_id), '{}') into covered
  from private.floor_group_members member
  where member.tenant_id = target_tenant_id
    and member.location_id = target_location_id
    and (member.group_id = any(touched) or member.table_id = any(requested));
  -- Loose tables of the request are covered too.
  select coalesce(array_agg(distinct all_tables.id), '{}') into covered
  from unnest(covered || requested) as all_tables(id);

  select coalesce(array_agg(picked), '{}') into fresh
  from unnest(requested) as picked
  where not exists (
    select 1 from private.floor_group_members member
    where member.tenant_id = target_tenant_id
      and member.location_id = target_location_id
      and member.table_id = picked
  );
  if cardinality(fresh) = 0 and cardinality(touched) < 2 then
    raise exception 'the tables are already together' using errcode = 'PT277';
  end if;
  if cardinality(covered) > 20 then
    raise exception 'a group has at most 20 tables' using errcode = 'PT277';
  end if;

  select count(distinct floor_table.level_id) into floors
  from private.floor_tables floor_table
  where floor_table.tenant_id = target_tenant_id
    and floor_table.location_id = target_location_id
    and floor_table.id = any(covered);
  if floors <> 1 then
    raise exception 'tables of different floors cannot be joined' using errcode = 'PT277';
  end if;

  -- A table that cannot be used does not enter a group.
  if exists (
    select 1
    from private.floor_table_service_states state
    where state.tenant_id = target_tenant_id
      and state.location_id = target_location_id
      and state.table_id = any(fresh)
      and state.state in ('needs_cleaning', 'out_of_service')
  ) then
    raise exception 'a table pending cleaning or out of service cannot be joined'
      using errcode = 'PT277';
  end if;

  -- Open accounts among everything being joined. More than one would mix debt of
  -- different people, so it is refused until one of them closes.
  select coalesce(array_agg(locked.id order by locked.id), '{}') into open_sessions
  from (
    select account_session.id
    from private.table_sessions account_session
    where account_session.tenant_id = target_tenant_id
      and account_session.location_id = target_location_id
      and account_session.status = 'open'
      and account_session.scope_key = any(touched || requested)
    order by account_session.id
    for update
  ) locked;
  if cardinality(open_sessions) > 1 then
    raise exception 'two different open accounts cannot be merged' using errcode = 'PT278';
  end if;
  account_id := open_sessions[1];

  -- The group that survives is the first of the touched ones, otherwise a new one.
  select group_row.id, group_row.name into kept_group, kept_name
  from private.floor_groups group_row
  where group_row.tenant_id = target_tenant_id
    and group_row.location_id = target_location_id
    and group_row.id = any(touched)
  order by group_row.position, group_row.id
  limit 1;
  absorbed := array(select unnest(touched) except select kept_group);

  if kept_group is null then
    kept_group := gen_random_uuid();
    select coalesce(max(group_row.position) + 1, 0) into next_position
    from private.floor_groups group_row
    where group_row.tenant_id = target_tenant_id
      and group_row.location_id = target_location_id;
    if (select count(*) from private.floor_groups group_row
        where group_row.tenant_id = target_tenant_id
          and group_row.location_id = target_location_id) >= 50 then
      raise exception 'a plan has at most 50 groups' using errcode = 'PT277';
    end if;
    kept_name := coalesce(clean_name, left((
      select 'Mesas ' || string_agg(floor_table.label, ' + ' order by floor_table.position, floor_table.id)
      from private.floor_tables floor_table
      where floor_table.tenant_id = target_tenant_id
        and floor_table.location_id = target_location_id
        and floor_table.id = any(covered)
    ), 60));
    insert into private.floor_groups (tenant_id, location_id, id, name, position)
    values (target_tenant_id, target_location_id, kept_group, kept_name, next_position);
  elsif clean_name is not null and clean_name <> kept_name then
    kept_name := clean_name;
    update private.floor_groups group_row
    set name = kept_name
    where group_row.tenant_id = target_tenant_id
      and group_row.location_id = target_location_id
      and group_row.id = kept_group;
  end if;

  -- Members of absorbed groups move over; loose tables of the request are added.
  update private.floor_group_members member
  set group_id = kept_group
  where member.tenant_id = target_tenant_id
    and member.location_id = target_location_id
    and member.group_id = any(absorbed);
  delete from private.floor_groups group_row
  where group_row.tenant_id = target_tenant_id
    and group_row.location_id = target_location_id
    and group_row.id = any(absorbed);
  insert into private.floor_group_members (
    tenant_id, location_id, group_id, table_id, position
  )
  select target_tenant_id, target_location_id, kept_group, picked, 1000 + ordinality
  from unnest(fresh) with ordinality as incoming(picked, ordinality);
  update private.floor_group_members member
  set position = ordered.position
  from (
    select renumber.table_id,
      (row_number() over (order by renumber.position, renumber.table_id) - 1)::integer as position
    from private.floor_group_members renumber
    where renumber.tenant_id = target_tenant_id
      and renumber.location_id = target_location_id
      and renumber.group_id = kept_group
  ) ordered
  where member.tenant_id = target_tenant_id
    and member.location_id = target_location_id
    and member.group_id = kept_group
    and member.table_id = ordered.table_id;

  if account_id is not null then
    -- The open account follows the group; its history stays where it is.
    perform set_config('private.regroup_session', 'on', true);
    update private.table_sessions account_session
    set scope_key = kept_group, group_id = kept_group
    where account_session.tenant_id = target_tenant_id
      and account_session.location_id = target_location_id
      and account_session.id = account_id
      and (account_session.scope_key <> kept_group
        or account_session.group_id is distinct from kept_group);
    perform set_config('private.regroup_session', 'off', true);

    -- The tables that joined an occupied group are occupied too.
    insert into private.floor_table_service_states (
      tenant_id, location_id, table_id, state
    )
    select target_tenant_id, target_location_id, joining, 'occupied'
    from unnest(covered) as joining
    on conflict (tenant_id, location_id, table_id) do nothing;
  end if;

  -- A stale editor must reload the plan instead of overwriting the new groups.
  update private.floor_plans plan
  set version = plan.version + 1, updated_at = now()
  where plan.tenant_id = target_tenant_id
    and plan.location_id = target_location_id;

  insert into private.table_group_events (
    tenant_id, location_id, kind, group_id, group_name, session_id,
    table_ids, merged_group_ids, actor_id, command_id
  ) values (
    target_tenant_id, target_location_id, 'joined', kept_group, kept_name,
    account_id, covered, absorbed, target_staff_id, target_command_id
  );
  perform private.append_audit_event(
    target_tenant_id, 'staff', target_staff_id, 'table_group.joined',
    'Mesas unidas durante el servicio sin mover pedidos ni pagos',
    'join:' || gen_random_uuid()::text, 'table_group', kept_group
  );

  return private.finish_waiter_command(
    target_tenant_id, target_location_id, target_staff_id, target_command_id,
    jsonb_build_object(
      'groupId', kept_group,
      'name', kept_name,
      'sessionId', account_id,
      'mergedGroupIds', to_jsonb(absorbed),
      'tables', private.table_group_tables(
        target_tenant_id, target_location_id, covered)
    )
  );
end;
$$;

-- 6. Separating ----------------------------------------------------------------------------

create function private.separate_tables(
  target_tenant_id uuid,
  target_location_id uuid,
  target_staff_id uuid,
  target_command_id uuid,
  target_group_id uuid,
  target_anchor_table_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_role text := private.waiter_actor_role(
    target_tenant_id, target_location_id, target_staff_id
  );
  stored jsonb;
  group_name_value text;
  members uuid[];
  account_id uuid;
  released uuid[];
begin
  stored := private.claim_waiter_command(
    target_tenant_id, target_location_id, target_staff_id, target_command_id,
    jsonb_build_object(
      'kind', 'separate_tables', 'groupId', target_group_id,
      'anchorTableId', target_anchor_table_id
    )
  );
  if stored is not null then
    return stored;
  end if;

  perform pg_advisory_xact_lock(
    private.table_groups_lock_key(target_tenant_id, target_location_id)
  );

  select group_row.name into group_name_value
  from private.floor_groups group_row
  where group_row.tenant_id = target_tenant_id
    and group_row.location_id = target_location_id
    and group_row.id = target_group_id;
  select coalesce(array_agg(member.table_id order by member.table_id), '{}') into members
  from private.floor_group_members member
  where member.tenant_id = target_tenant_id
    and member.location_id = target_location_id
    and member.group_id = target_group_id;
  if group_name_value is null
    or cardinality(members) = 0
    or exists (
      select 1 from unnest(members) as member_table
      where not private.waiter_serves_table(
        target_tenant_id, target_location_id, target_staff_id, actor_role,
        member_table
      )
    )
  then
    raise exception 'group not found' using errcode = 'PT201';
  end if;

  select account_session.id into account_id
  from private.table_sessions account_session
  where account_session.tenant_id = target_tenant_id
    and account_session.location_id = target_location_id
    and account_session.scope_key = target_group_id
    and account_session.status = 'open'
  for update;

  if target_anchor_table_id is not null
    and target_anchor_table_id <> all(members)
  then
    raise exception 'the anchor table must belong to the group' using errcode = 'PT279';
  end if;
  if account_id is not null and target_anchor_table_id is null then
    raise exception 'choose the table that keeps the open account' using errcode = 'PT279';
  end if;

  if account_id is not null then
    perform set_config('private.regroup_session', 'on', true);
    update private.table_sessions account_session
    set table_id = target_anchor_table_id,
        group_id = null,
        scope_key = target_anchor_table_id
    where account_session.tenant_id = target_tenant_id
      and account_session.location_id = target_location_id
      and account_session.id = account_id;
    perform set_config('private.regroup_session', 'off', true);

    -- The anchor carries the account, whatever else it was.
    insert into private.floor_table_service_states (
      tenant_id, location_id, table_id, state
    ) values (
      target_tenant_id, target_location_id, target_anchor_table_id, 'occupied'
    )
    on conflict (tenant_id, location_id, table_id) do nothing;
  end if;

  -- Released according to state: a table that was only occupied becomes available;
  -- one pending cleaning or out of service keeps that state.
  with freed as (
    delete from private.floor_table_service_states state
    where state.tenant_id = target_tenant_id
      and state.location_id = target_location_id
      and state.table_id = any(members)
      and state.table_id is distinct from target_anchor_table_id
      and state.state = 'occupied'
    returning state.table_id
  )
  select coalesce(array_agg(freed.table_id order by freed.table_id), '{}') into released
  from freed;

  delete from private.floor_groups group_row
  where group_row.tenant_id = target_tenant_id
    and group_row.location_id = target_location_id
    and group_row.id = target_group_id;

  update private.floor_plans plan
  set version = plan.version + 1, updated_at = now()
  where plan.tenant_id = target_tenant_id
    and plan.location_id = target_location_id;

  insert into private.table_group_events (
    tenant_id, location_id, kind, group_id, group_name, session_id,
    anchor_table_id, table_ids, released_table_ids, actor_id, command_id
  ) values (
    target_tenant_id, target_location_id, 'separated', target_group_id,
    group_name_value, account_id, target_anchor_table_id, members, released,
    target_staff_id, target_command_id
  );
  perform private.append_audit_event(
    target_tenant_id, 'staff', target_staff_id, 'table_group.separated',
    'Mesas separadas durante el servicio sin mover pedidos ni pagos',
    'separate:' || gen_random_uuid()::text, 'table_group', target_group_id
  );

  return private.finish_waiter_command(
    target_tenant_id, target_location_id, target_staff_id, target_command_id,
    jsonb_build_object(
      'groupId', target_group_id,
      'name', group_name_value,
      'sessionId', account_id,
      'anchorTableId', target_anchor_table_id,
      'releasedTableIds', to_jsonb(released),
      'tables', private.table_group_tables(
        target_tenant_id, target_location_id, members)
    )
  );
end;
$$;

revoke all on function
  private.table_groups_lock_key(uuid, uuid),
  private.guard_plan_groups_vs_sessions(),
  private.table_group_tables(uuid, uuid, uuid[]),
  private.join_tables(uuid, uuid, uuid, uuid, uuid[], text),
  private.separate_tables(uuid, uuid, uuid, uuid, uuid, uuid)
from public, anon, authenticated, authenticator;
grant execute on function
  private.join_tables(uuid, uuid, uuid, uuid, uuid[], text),
  private.separate_tables(uuid, uuid, uuid, uuid, uuid, uuid)
to authenticator;

commit;
