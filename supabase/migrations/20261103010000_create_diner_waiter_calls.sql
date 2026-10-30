begin;

-- Diner calls to the waiter: "call the waiter", "ask for the bill" and "help".
--
-- They reuse private.waiter_calls (the T18 order validation call lives there
-- too), so the salon view, the claim flow and the Realtime invalidation trigger
-- (waiter_calls_realtime, T-realtime) already cover them. A diner call has no
-- order intent and no payment method.

-- 1. Table shape ------------------------------------------------------------

alter table private.waiter_calls drop constraint waiter_calls_reason_check;
alter table private.waiter_calls
  alter column intent_id drop not null,
  alter column payment_method drop not null,
  add constraint waiter_calls_reason_check check (
    reason in ('order_validation', 'call_waiter', 'request_bill', 'help')
  ),
  -- An order validation call always belongs to an intent and a payment method;
  -- a diner call never does.
  add constraint waiter_calls_reason_shape check (
    (reason = 'order_validation' and intent_id is not null and payment_method is not null)
    or (reason <> 'order_validation' and intent_id is null and payment_method is null)
  );

-- One live call per table and reason: asking again while it is still open (or
-- being attended) returns the same call instead of piling up noise.
create unique index waiter_calls_one_live_per_reason
  on private.waiter_calls (tenant_id, location_id, table_id, reason)
  where reason <> 'order_validation' and status in ('open', 'acknowledged');

create index waiter_calls_diner_recent_idx
  on private.waiter_calls (tenant_id, location_id, table_id, created_at desc)
  where reason <> 'order_validation';

-- 2. The salon view reports the real reason ---------------------------------
-- Patches two lines of the T19 definition (as T22 did) and fails loudly if the
-- lines are not found.
do $patch$
declare
  definition text;
begin
  select pg_get_functiondef('private.waiter_salon_view(uuid,uuid,uuid)'::regprocedure)
  into definition;
  if position($e$select call.id, call.table_id, call.intent_id, call.payment_method,$e$ in definition) = 0
    or position($e$'reason', 'order_validation',$e$ in definition) = 0
  then
    raise exception 'waiter_salon_view no longer has the T19 call placeholders';
  end if;
  definition := replace(definition,
    $e$select call.id, call.table_id, call.intent_id, call.payment_method,$e$,
    $e$select call.id, call.table_id, call.intent_id, call.payment_method, call.reason,$e$);
  definition := replace(definition,
    $e$'reason', 'order_validation',$e$,
    $e$'reason', open_calls.reason,$e$);
  execute definition;
end
$patch$;

-- 3. Diner entry point ------------------------------------------------------
-- The tenant and location come from the host the API already proved; the table
-- comes only from the QR token. Error codes:
--   PT101 unknown token, PT102 the table cannot be called from now,
--   PT120 invalid reason, PT121 the bill needs an open table,
--   PT122 too many calls for this table.

create function private.create_waiter_call(
  target_tenant_id uuid,
  target_location_id uuid,
  target_token text,
  target_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
declare
  entry record;
  existing private.waiter_calls%rowtype;
  new_id uuid;
begin
  if target_reason is null
    or target_reason not in ('call_waiter', 'request_bill', 'help')
  then
    raise exception 'invalid waiter call reason' using errcode = 'PT120';
  end if;

  perform 1
  from private.floor_table_qr_codes qr
  join private.floor_tables floor_table
    on floor_table.tenant_id = qr.tenant_id
    and floor_table.location_id = qr.location_id
    and floor_table.id = qr.table_id
  where qr.tenant_id = target_tenant_id
    and qr.location_id = target_location_id
    and qr.token = target_token
    and qr.status = 'active'
    and floor_table.retired_at is null
  for share of qr, floor_table;
  if not found then
    raise exception 'invalid table entry' using errcode = 'PT101';
  end if;

  select * into entry
  from private.resolve_table_entry(target_tenant_id, target_location_id, target_token);
  if not found then
    raise exception 'invalid table entry' using errcode = 'PT101';
  end if;
  -- A suspended tenant keeps serving the tables that are already seated but
  -- takes no call from a table nobody is using.
  if not entry.published
    or (entry.service_state <> 'occupied' and not entry.accepts_new_tables)
  then
    raise exception 'table cannot call the waiter' using errcode = 'PT102';
  end if;
  if target_reason = 'request_bill' and entry.service_state <> 'occupied' then
    raise exception 'there is no open table to bill' using errcode = 'PT121';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      target_tenant_id::text || target_location_id::text || entry.table_id::text, 0
    )
  );

  select * into existing
  from private.waiter_calls call
  where call.tenant_id = target_tenant_id
    and call.location_id = target_location_id
    and call.table_id = entry.table_id
    and call.reason = target_reason
    and call.status in ('open', 'acknowledged');
  if found then
    return jsonb_build_object(
      'callId', existing.id, 'created', false,
      'reason', existing.reason, 'status', existing.status
    );
  end if;

  -- Frequency limit per table: a call that was attended and closed can be made
  -- again, but not endlessly.
  if (
    select count(*) from private.waiter_calls call
    where call.tenant_id = target_tenant_id
      and call.location_id = target_location_id
      and call.table_id = entry.table_id
      and call.reason <> 'order_validation'
      and call.created_at > now() - interval '10 minutes'
  ) >= 6 then
    raise exception 'too many waiter calls' using errcode = 'PT122';
  end if;

  new_id := gen_random_uuid();
  insert into private.waiter_calls (id, tenant_id, location_id, table_id, reason)
  values (new_id, target_tenant_id, target_location_id, entry.table_id, target_reason);
  return jsonb_build_object(
    'callId', new_id, 'created', true, 'reason', target_reason, 'status', 'open'
  );
end;
$$;

-- 4. Staff resolves a diner call ----------------------------------------------
-- An order validation call is closed by deciding its intent, never from here.

create function private.resolve_waiter_call(
  target_tenant_id uuid,
  target_location_id uuid,
  target_staff_id uuid,
  target_call_id uuid,
  target_command_id uuid
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
  call_row private.waiter_calls%rowtype;
begin
  stored := private.claim_waiter_command(
    target_tenant_id, target_location_id, target_staff_id, target_command_id,
    jsonb_build_object('kind', 'resolve_call', 'callId', target_call_id)
  );
  if stored is not null then
    return stored;
  end if;

  select * into call_row
  from private.waiter_calls call
  where call.tenant_id = target_tenant_id
    and call.location_id = target_location_id
    and call.id = target_call_id
  for update;
  if not found or not private.waiter_serves_table(
    target_tenant_id, target_location_id, target_staff_id, actor_role,
    call_row.table_id
  ) then
    raise exception 'call not found' using errcode = 'PT201';
  end if;
  if call_row.reason = 'order_validation' then
    raise exception 'invalid decision' using errcode = 'PT212';
  end if;
  if call_row.status not in ('open', 'acknowledged') then
    raise exception 'call is closed' using errcode = 'PT204';
  end if;
  -- A call claimed by another waiter is theirs; a manager may still resolve it.
  if call_row.status = 'acknowledged'
    and call_row.claimed_by <> target_staff_id
    and actor_role <> 'manager'
  then
    raise exception 'call already claimed' using errcode = 'PT203';
  end if;

  update private.waiter_calls call
  set status = 'closed',
      claimed_by = coalesce(call.claimed_by, target_staff_id),
      claimed_at = coalesce(call.claimed_at, now()),
      updated_at = now()
  where call.tenant_id = target_tenant_id
    and call.location_id = target_location_id
    and call.id = target_call_id;
  perform private.append_audit_event(
    target_tenant_id, 'staff', target_staff_id, 'waiter_call.resolved',
    'Llamado de mesa resuelto por el personal', 'waiter:' || gen_random_uuid()::text,
    'waiter_call', target_call_id
  );

  return private.finish_waiter_command(
    target_tenant_id, target_location_id, target_staff_id, target_command_id,
    jsonb_build_object('callId', target_call_id, 'status', 'closed')
  );
end;
$$;

revoke all on function
  private.create_waiter_call(uuid, uuid, text, text),
  private.resolve_waiter_call(uuid, uuid, uuid, uuid, uuid)
from public, anon, authenticated;

grant execute on function
  private.create_waiter_call(uuid, uuid, text, text),
  private.resolve_waiter_call(uuid, uuid, uuid, uuid, uuid)
to authenticator;

commit;
