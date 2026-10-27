begin;

-- T31: the diner's page also learns that something changed, on a channel of ITS table:
-- tenant:<tenant>:location:<location>:table-<table>. The API hands the phone a token for
-- exactly that channel after it checks the QR token, so a diner hears their own table (and
-- the tables grouped with it) and nobody else's. As for the staff, a message carries no
-- data: the page asks the API again. The policy on realtime.messages is the one from
-- 20261031010000: a token hears the channels in its `channels` claim.

create function private.notify_tables(
  target_tenant_id uuid,
  target_location_id uuid,
  target_table_ids uuid[]
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  one uuid;
begin
  foreach one in array coalesce(target_table_ids, '{}'::uuid[]) loop
    perform private.notify_realtime(
      target_tenant_id, target_location_id, 'table-' || one::text);
  end loop;
exception when others then
  null;
end;
$$;

-- The tables that share a party with a table session: itself and its group.
create function private.session_tables(
  target_tenant_id uuid,
  target_location_id uuid,
  target_table_id uuid,
  target_group_id uuid
)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select array_remove(
    array[target_table_id] || coalesce((
      select array_agg(member.table_id)
      from private.floor_group_members member
      where member.tenant_id = target_tenant_id
        and member.location_id = target_location_id
        and member.group_id = target_group_id
    ), '{}'::uuid[]),
    null);
$$;

-- Rows that name one table: its service state and its group membership.
create function private.rt_diner_table()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  changed record;
begin
  if tg_op = 'DELETE' then changed := old; else changed := new; end if;
  perform private.notify_tables(
    changed.tenant_id, changed.location_id, array[changed.table_id]);
  return null;
end;
$$;

create function private.rt_diner_session()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  changed record;
begin
  if tg_op = 'DELETE' then changed := old; else changed := new; end if;
  perform private.notify_tables(
    changed.tenant_id, changed.location_id,
    private.session_tables(
      changed.tenant_id, changed.location_id, changed.table_id, changed.group_id));
  return null;
end;
$$;

create function private.rt_diner_group_event()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform private.notify_tables(
    new.tenant_id, new.location_id,
    coalesce(new.table_ids, '{}'::uuid[])
      || coalesce(new.released_table_ids, '{}'::uuid[]));
  return null;
end;
$$;

-- The shares of a split belong to its session: the table and its group.
create function private.rt_diner_split()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  changed record;
  found_session record;
begin
  if tg_op = 'DELETE' then changed := old; else changed := new; end if;
  select session.tenant_id, session.location_id, session.table_id, session.group_id
  into found_session
  from private.account_splits split
  join private.table_sessions session
    on session.tenant_id = split.tenant_id
    and session.location_id = split.location_id
    and session.id = split.session_id
  where split.id = changed.split_id;
  if found then
    perform private.notify_tables(
      found_session.tenant_id, found_session.location_id,
      private.session_tables(
        found_session.tenant_id, found_session.location_id,
        found_session.table_id, found_session.group_id));
  end if;
  return null;
end;
$$;

create trigger floor_table_service_states_diner_realtime
after insert or update or delete on private.floor_table_service_states
for each row execute function private.rt_diner_table();
create trigger floor_group_members_diner_realtime
after insert or update or delete on private.floor_group_members
for each row execute function private.rt_diner_table();
create trigger table_sessions_diner_realtime
after insert or update or delete on private.table_sessions
for each row execute function private.rt_diner_session();
create trigger table_group_events_diner_realtime
after insert on private.table_group_events
for each row execute function private.rt_diner_group_event();
create trigger account_split_shares_diner_realtime
after insert or update or delete on private.account_split_shares
for each row execute function private.rt_diner_split();
create trigger account_split_assignments_diner_realtime
after insert or update or delete on private.account_split_assignments
for each row execute function private.rt_diner_split();

revoke all on function
  private.notify_tables(uuid, uuid, uuid[]),
  private.session_tables(uuid, uuid, uuid, uuid),
  private.rt_diner_table(), private.rt_diner_session(),
  private.rt_diner_group_event(), private.rt_diner_split()
from public, anon, authenticated, authenticator;

commit;
