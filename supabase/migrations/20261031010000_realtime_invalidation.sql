begin;

-- T31: Realtime only TELLS the screens that something changed; they ask the API for the
-- authoritative state. A message carries no data, only "this topic changed", on a private
-- channel named tenant:<tenant>:location:<location>:<topic>. Nobody can write to a channel
-- from a browser (no insert policy) and a subscriber only receives the channels the API put
-- in the `channels` claim of its short-lived token, so one restaurant never hears another,
-- and kitchen never hears bar.
--
-- Topics: salon (calls, intents, orders, accounts, requests, plan), cash (register and the
-- ledger) and production-kitchen / production-bar (the screens of each sector kind).
--
-- Publishing must never cost a write: every send is wrapped, and within one transaction a
-- topic is announced once, however many rows changed.

-- 1. Who may listen ----------------------------------------------------------------------

create policy staff_receive_invalidations on realtime.messages
for select to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and (select realtime.topic()) in (
    select jsonb_array_elements_text(
      case when jsonb_typeof(auth.jwt() -> 'channels') = 'array'
        then auth.jwt() -> 'channels' else '[]'::jsonb end))
);

-- 2. Announcing a change -----------------------------------------------------------------

create function private.notify_realtime(
  target_tenant_id uuid,
  target_location_id uuid,
  target_topic text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  channel text := 'tenant:' || target_tenant_id::text || ':location:'
    || target_location_id::text || ':' || target_topic;
  seen text := coalesce(current_setting('private.realtime_seen', true), '');
begin
  if position('|' || channel || '|' in seen) > 0 then
    return;
  end if;
  perform set_config('private.realtime_seen', seen || '|' || channel || '|', true);
  perform realtime.send(
    jsonb_build_object('at', clock_timestamp()), 'changed', channel, true);
exception when others then
  -- A missed notification is repaired by the next poll; a failed write is not.
  null;
end;
$$;

create function private.rt_salon()
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
  perform private.notify_realtime(changed.tenant_id, changed.location_id, 'salon');
  return null;
end;
$$;

create function private.rt_cash()
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
  perform private.notify_realtime(changed.tenant_id, changed.location_id, 'cash');
  -- The waiter's screen also shows whether the register is open.
  perform private.notify_realtime(changed.tenant_id, changed.location_id, 'salon');
  return null;
end;
$$;

-- The ledger feeds the accounts screen and the register.
create function private.rt_ledger()
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
  perform private.notify_realtime(changed.tenant_id, changed.location_id, 'salon');
  perform private.notify_realtime(changed.tenant_id, changed.location_id, 'cash');
  return null;
end;
$$;

-- An item moving along its stages is news for the sector's screen and for the orders
-- in progress of the floor.
create function private.rt_production()
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
  if changed.sector_kind in ('kitchen', 'bar') then
    perform private.notify_realtime(
      changed.tenant_id, changed.location_id, 'production-' || changed.sector_kind);
  end if;
  perform private.notify_realtime(changed.tenant_id, changed.location_id, 'salon');
  return null;
end;
$$;

-- The shares of a split carry no business or location of their own: their split does.
create function private.rt_split_part()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  changed record;
  owner record;
begin
  if tg_op = 'DELETE' then changed := old; else changed := new; end if;
  select s.tenant_id, s.location_id into owner
  from private.account_splits s
  where s.id = changed.split_id;
  if found then
    perform private.notify_realtime(owner.tenant_id, owner.location_id, 'salon');
  end if;
  return null;
end;
$$;

create trigger waiter_calls_realtime
after insert or update or delete on private.waiter_calls
for each row execute function private.rt_salon();
create trigger order_intents_realtime
after insert or update or delete on private.order_intents
for each row execute function private.rt_salon();
create trigger confirmed_orders_realtime
after insert or update or delete on private.confirmed_orders
for each row execute function private.rt_salon();
create trigger table_sessions_realtime
after insert or update or delete on private.table_sessions
for each row execute function private.rt_salon();
create trigger cashier_requests_realtime
after insert or update or delete on private.cashier_requests
for each row execute function private.rt_salon();
create trigger table_group_events_realtime
after insert on private.table_group_events
for each row execute function private.rt_salon();
create trigger floor_tables_realtime
after insert or update or delete on private.floor_tables
for each row execute function private.rt_salon();
create trigger account_entries_realtime
after insert or update or delete on private.account_entries
for each row execute function private.rt_ledger();
create trigger account_splits_realtime
after insert or update or delete on private.account_splits
for each row execute function private.rt_salon();
create trigger account_decisions_realtime
after insert or update or delete on private.account_decisions
for each row execute function private.rt_salon();
create trigger order_adjustments_realtime
after insert or update or delete on private.order_adjustments
for each row execute function private.rt_salon();
create trigger online_payments_realtime
after insert or update or delete on private.online_payments
for each row execute function private.rt_salon();
create trigger floor_table_service_states_realtime
after insert or update or delete on private.floor_table_service_states
for each row execute function private.rt_salon();
create trigger floor_groups_realtime
after insert or update or delete on private.floor_groups
for each row execute function private.rt_salon();
create trigger floor_group_members_realtime
after insert or update or delete on private.floor_group_members
for each row execute function private.rt_salon();
create trigger staff_sector_assignments_realtime
after insert or update or delete on private.staff_sector_assignments
for each row execute function private.rt_salon();
create trigger account_split_shares_realtime
after insert or update or delete on private.account_split_shares
for each row execute function private.rt_split_part();
create trigger account_split_assignments_realtime
after insert or update or delete on private.account_split_assignments
for each row execute function private.rt_split_part();
create trigger cash_shifts_realtime
after insert or update or delete on private.cash_shifts
for each row execute function private.rt_cash();
create trigger cash_movements_realtime
after insert or update or delete on private.cash_movements
for each row execute function private.rt_cash();
create trigger production_items_realtime
after insert or update or delete on private.production_items
for each row execute function private.rt_production();

revoke all on function
  private.notify_realtime(uuid, uuid, text),
  private.rt_salon(), private.rt_cash(), private.rt_ledger(), private.rt_production(), private.rt_split_part()
from public, anon, authenticated, authenticator;

commit;
