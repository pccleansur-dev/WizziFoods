begin;

-- Cash register (T23): shifts, blind count, manual movements and refunds.
--
-- One register per location is open at a time, opened and closed by a manager.
-- Every in-person collection and refund is attributed to the open shift, so the
-- cash that should be in the drawer is always DERIVED from the ledger and the
-- shift's movements, never stored as a free field. Closing asks for the counted
-- cash without showing the expected amount (blind count): a difference needs a
-- justification and everything is kept in append-only records.
--
-- Physical cards never go through here: only the method is recorded, there is
-- no column for a card number, an expiry or a security code.
-- Online payments (T24) and splitting by person (T25) are not here.

-- 1. Shifts ------------------------------------------------------------------------------

create table private.cash_shifts (
  id uuid not null default gen_random_uuid(),
  tenant_id uuid not null,
  location_id uuid not null,
  opened_by uuid not null,
  opened_at timestamptz not null default now(),
  opening_cash_cents integer not null
    check (opening_cash_cents between 0 and 1000000000),
  status text not null default 'open' check (status in ('open', 'closed')),
  closed_at timestamptz,
  primary key (tenant_id, location_id, id),
  foreign key (tenant_id, location_id)
    references public.locations(tenant_id, id) on delete cascade,
  foreign key (tenant_id, opened_by)
    references public.staff_members(tenant_id, id) on delete restrict,
  check ((status = 'closed') = (closed_at is not null))
);

-- At most one open register per location.
create unique index cash_shifts_one_open_idx
  on private.cash_shifts (tenant_id, location_id)
  where status = 'open';

-- A shift is only ever closed; nothing else about it changes.
create function private.guard_cash_shift_change()
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
    raise exception 'a cash shift is never deleted or rewritten' using errcode = 'PT209';
  end if;
  return new;
end;
$$;

create trigger cash_shifts_guard_change
before update or delete on private.cash_shifts
for each row execute function private.guard_cash_shift_change();
create trigger cash_shifts_no_truncate
before truncate on private.cash_shifts
for each statement execute function private.reject_append_only_change();

create table private.cash_shift_closures (
  tenant_id uuid not null,
  location_id uuid not null,
  shift_id uuid not null,
  closed_by uuid not null,
  closed_at timestamptz not null default now(),
  counted_cash_cents integer not null
    check (counted_cash_cents between 0 and 1000000000),
  expected_cash_cents integer not null,
  difference_cents integer not null,
  reason text check (reason is null or length(reason) between 1 and 200),
  pending_accounts integer not null check (pending_accounts >= 0),
  pending_cents integer not null,
  breakdown jsonb not null check (jsonb_typeof(breakdown) = 'object'),
  command_id uuid not null,
  primary key (tenant_id, location_id, shift_id),
  foreign key (tenant_id, location_id, shift_id)
    references private.cash_shifts(tenant_id, location_id, id) on delete restrict,
  foreign key (tenant_id, closed_by)
    references public.staff_members(tenant_id, id) on delete restrict,
  check (difference_cents = counted_cash_cents - expected_cash_cents),
  -- A difference is only accepted with its justification.
  check (difference_cents = 0 or reason is not null)
);

create table private.cash_movements (
  id uuid not null default gen_random_uuid(),
  tenant_id uuid not null,
  location_id uuid not null,
  shift_id uuid not null,
  kind text not null check (kind in ('cash_in', 'cash_out')),
  amount_cents integer not null check (amount_cents between 1 and 1000000000),
  reason text not null check (length(reason) between 1 and 200),
  actor_id uuid not null,
  command_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, location_id, id),
  foreign key (tenant_id, location_id, shift_id)
    references private.cash_shifts(tenant_id, location_id, id) on delete restrict,
  foreign key (tenant_id, actor_id)
    references public.staff_members(tenant_id, id) on delete restrict
);

create trigger cash_shift_closures_append_only
before update or delete on private.cash_shift_closures
for each row execute function private.reject_append_only_change();
create trigger cash_shift_closures_no_truncate
before truncate on private.cash_shift_closures
for each statement execute function private.reject_append_only_change();
create trigger cash_movements_append_only
before update or delete on private.cash_movements
for each row execute function private.reject_append_only_change();
create trigger cash_movements_no_truncate
before truncate on private.cash_movements
for each statement execute function private.reject_append_only_change();

revoke all on table
  private.cash_shifts, private.cash_shift_closures, private.cash_movements
from public, anon, authenticated, authenticator;

-- 2. Ledger links ----------------------------------------------------------------------------

alter table private.account_entries
  add column shift_id uuid,
  add column refund_of_source_id uuid,
  add column item_line_id uuid,
  drop constraint account_entries_origin_check,
  drop constraint account_entries_source_type_check,
  add constraint account_entries_origin_check check (
    origin in (
      'order_confirmed', 'item_cancelled', 'item_replaced', 'payment',
      'discount', 'refund', 'manual'
    )
  ),
  add constraint account_entries_source_type_check check (
    source_type in (
      'confirmed_order_item', 'order_adjustment', 'payment', 'discount', 'refund'
    )
  ),
  add constraint account_entries_shift_fkey
    foreign key (tenant_id, location_id, shift_id)
    references private.cash_shifts(tenant_id, location_id, id) on delete restrict,
  -- Only money that physically moves belongs to a shift, and a refund always
  -- points at the payment it returns.
  add constraint account_entries_shift_kind_check check (
    shift_id is null or kind in ('payment', 'tip', 'refund')
  ),
  add constraint account_entries_refund_link_check check (
    (kind = 'refund') = (refund_of_source_id is not null)
  ),
  add constraint account_entries_item_link_check check (
    item_line_id is null or kind = 'refund'
  );

create index account_entries_shift_idx
  on private.account_entries (tenant_id, location_id, shift_id)
  where shift_id is not null;
create index account_entries_refund_idx
  on private.account_entries (tenant_id, location_id, refund_of_source_id)
  where refund_of_source_id is not null;

create function private.current_cash_shift_id(
  target_tenant_id uuid,
  target_location_id uuid
)
returns uuid
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select shift.id
  from private.cash_shifts shift
  where shift.tenant_id = target_tenant_id
    and shift.location_id = target_location_id
    and shift.status = 'open';
$$;

-- 3. Opening, moving cash and closing ---------------------------------------------------------

create function private.open_cash_shift(
  target_tenant_id uuid,
  target_location_id uuid,
  target_staff_id uuid,
  target_command_id uuid,
  target_opening_cash_cents integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_role text;
  stored jsonb;
  new_shift uuid := gen_random_uuid();
  opened timestamptz := now();
begin
  select member.role into actor_role
  from public.staff_members member
  where member.tenant_id = target_tenant_id
    and member.location_id = target_location_id
    and member.id = target_staff_id
    and member.is_active;
  if actor_role is null then
    raise exception 'staff member cannot operate the salon' using errcode = 'PT200';
  end if;
  if actor_role <> 'manager' then
    raise exception 'only a manager can open the register' using errcode = 'PT222';
  end if;

  stored := private.claim_waiter_command(
    target_tenant_id, target_location_id, target_staff_id, target_command_id,
    jsonb_build_object('kind', 'open_cash_shift', 'openingCashCents', target_opening_cash_cents)
  );
  if stored is not null then
    return stored;
  end if;
  if target_opening_cash_cents is null
    or target_opening_cash_cents < 0
    or target_opening_cash_cents > 1000000000
  then
    raise exception 'invalid opening cash' using errcode = 'PT212';
  end if;
  if private.current_cash_shift_id(target_tenant_id, target_location_id) is not null then
    raise exception 'the register is already open' using errcode = 'PT241';
  end if;

  begin
    insert into private.cash_shifts (
      id, tenant_id, location_id, opened_by, opened_at, opening_cash_cents
    ) values (
      new_shift, target_tenant_id, target_location_id, target_staff_id, opened,
      target_opening_cash_cents
    );
  exception when unique_violation then
    raise exception 'the register is already open' using errcode = 'PT241';
  end;
  perform private.append_audit_event(
    target_tenant_id, 'staff', target_staff_id, 'cash_shift.opened',
    'Caja abierta por el encargado', 'cash:' || gen_random_uuid()::text,
    'cash_shift', new_shift
  );

  return private.finish_waiter_command(
    target_tenant_id, target_location_id, target_staff_id, target_command_id,
    jsonb_build_object(
      'shiftId', new_shift,
      'openingCashCents', target_opening_cash_cents,
      'openedAt', opened
    )
  );
end;
$$;

create function private.record_cash_movement(
  target_tenant_id uuid,
  target_location_id uuid,
  target_staff_id uuid,
  target_command_id uuid,
  target_kind text,
  target_amount_cents integer,
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
  actor_role text;
  stored jsonb;
  clean_reason text;
  open_shift uuid;
  movement uuid := gen_random_uuid();
begin
  select member.role into actor_role
  from public.staff_members member
  where member.tenant_id = target_tenant_id
    and member.location_id = target_location_id
    and member.id = target_staff_id
    and member.is_active;
  if actor_role is null then
    raise exception 'staff member cannot operate the salon' using errcode = 'PT200';
  end if;
  if actor_role <> 'manager' then
    raise exception 'only a manager can move cash' using errcode = 'PT222';
  end if;

  stored := private.claim_waiter_command(
    target_tenant_id, target_location_id, target_staff_id, target_command_id,
    jsonb_build_object(
      'kind', 'cash_movement', 'movementKind', target_kind,
      'amountCents', target_amount_cents, 'reason', target_reason
    )
  );
  if stored is not null then
    return stored;
  end if;
  clean_reason := private.required_reason(target_reason);
  if target_kind not in ('cash_in', 'cash_out')
    or target_amount_cents is null
    or target_amount_cents < 1
    or target_amount_cents > 1000000000
  then
    raise exception 'invalid cash movement' using errcode = 'PT212';
  end if;
  open_shift := private.current_cash_shift_id(target_tenant_id, target_location_id);
  if open_shift is null then
    raise exception 'the register is closed' using errcode = 'PT240';
  end if;

  insert into private.cash_movements (
    id, tenant_id, location_id, shift_id, kind, amount_cents, reason,
    actor_id, command_id
  ) values (
    movement, target_tenant_id, target_location_id, open_shift, target_kind,
    target_amount_cents, clean_reason, target_staff_id, target_command_id
  );
  perform private.append_audit_event(
    target_tenant_id, 'staff', target_staff_id, 'cash_movement.recorded',
    'Movimiento manual de efectivo', 'cash:' || gen_random_uuid()::text,
    'cash_movement', movement
  );

  return private.finish_waiter_command(
    target_tenant_id, target_location_id, target_staff_id, target_command_id,
    jsonb_build_object(
      'movementId', movement,
      'shiftId', open_shift,
      'kind', target_kind,
      'amountCents', target_amount_cents
    )
  );
end;
$$;

-- The breakdown of a shift by payment method, derived from the ledger. Cash is
-- what physically sits in the drawer; the rest is reported but not counted.
create function private.cash_shift_breakdown(
  target_tenant_id uuid,
  target_location_id uuid,
  target_shift_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  with method_totals as (
    select entry.payment_method as method,
      coalesce(-sum(entry.amount_cents) filter (where entry.kind = 'payment'), 0)::integer as received,
      coalesce(sum(entry.amount_cents) filter (where entry.kind = 'refund'), 0)::integer as refunded
    from private.account_entries entry
    where entry.tenant_id = target_tenant_id
      and entry.location_id = target_location_id
      and entry.shift_id = target_shift_id
      and entry.payment_method is not null
    group by entry.payment_method
  ),
  manual as (
    select
      coalesce(sum(movement.amount_cents) filter (where movement.kind = 'cash_in'), 0)::integer as cash_in,
      coalesce(sum(movement.amount_cents) filter (where movement.kind = 'cash_out'), 0)::integer as cash_out
    from private.cash_movements movement
    where movement.tenant_id = target_tenant_id
      and movement.location_id = target_location_id
      and movement.shift_id = target_shift_id
  )
  select jsonb_build_object(
    'methods', coalesce((
      select jsonb_object_agg(method_totals.method, jsonb_build_object(
        'receivedCents', method_totals.received,
        'refundedCents', method_totals.refunded
      ))
      from method_totals
    ), '{}'::jsonb),
    'manualInCents', manual.cash_in,
    'manualOutCents', manual.cash_out,
    'tipCents', coalesce((
      select sum(entry.amount_cents)
      from private.account_entries entry
      where entry.tenant_id = target_tenant_id
        and entry.location_id = target_location_id
        and entry.shift_id = target_shift_id
        and entry.kind = 'tip'
    ), 0)::integer
  )
  from manual;
$$;

create function private.expected_cash_cents(
  target_tenant_id uuid,
  target_location_id uuid,
  target_shift_id uuid
)
returns integer
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select (
    shift.opening_cash_cents
    + coalesce((breakdown -> 'methods' -> 'cash' ->> 'receivedCents')::integer, 0)
    - coalesce((breakdown -> 'methods' -> 'cash' ->> 'refundedCents')::integer, 0)
    + (breakdown ->> 'manualInCents')::integer
    - (breakdown ->> 'manualOutCents')::integer
  )::integer
  from private.cash_shifts shift,
    lateral (
      select private.cash_shift_breakdown(
        target_tenant_id, target_location_id, target_shift_id
      ) as breakdown
    ) computed
  where shift.tenant_id = target_tenant_id
    and shift.location_id = target_location_id
    and shift.id = target_shift_id;
$$;

-- Blind count: the counted cash comes first and the expected amount is only
-- revealed once the shift is closed. A difference needs its justification, and
-- without it nothing is written.
create function private.close_cash_shift(
  target_tenant_id uuid,
  target_location_id uuid,
  target_staff_id uuid,
  target_command_id uuid,
  target_counted_cash_cents integer,
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
  actor_role text;
  stored jsonb;
  clean_reason text := nullif(btrim(coalesce(target_reason, '')), '');
  open_shift private.cash_shifts%rowtype;
  expected integer;
  difference integer;
  pending_count integer;
  pending_total integer;
  breakdown jsonb;
begin
  select member.role into actor_role
  from public.staff_members member
  where member.tenant_id = target_tenant_id
    and member.location_id = target_location_id
    and member.id = target_staff_id
    and member.is_active;
  if actor_role is null then
    raise exception 'staff member cannot operate the salon' using errcode = 'PT200';
  end if;
  if actor_role <> 'manager' then
    raise exception 'only a manager can close the register' using errcode = 'PT222';
  end if;

  stored := private.claim_waiter_command(
    target_tenant_id, target_location_id, target_staff_id, target_command_id,
    jsonb_build_object(
      'kind', 'close_cash_shift', 'countedCashCents', target_counted_cash_cents,
      'reason', clean_reason
    )
  );
  if stored is not null then
    return stored;
  end if;
  if target_counted_cash_cents is null
    or target_counted_cash_cents < 0
    or target_counted_cash_cents > 1000000000
    or (clean_reason is not null and length(clean_reason) > 200)
  then
    raise exception 'invalid cash count' using errcode = 'PT212';
  end if;

  select * into open_shift
  from private.cash_shifts shift
  where shift.tenant_id = target_tenant_id
    and shift.location_id = target_location_id
    and shift.status = 'open'
  for update;
  if not found then
    raise exception 'the register is closed' using errcode = 'PT240';
  end if;

  expected := private.expected_cash_cents(
    target_tenant_id, target_location_id, open_shift.id
  );
  difference := target_counted_cash_cents - expected;
  if difference <> 0 and clean_reason is null then
    -- Blind: only the difference is told, never the expected cash.
    return private.finish_waiter_command(
      target_tenant_id, target_location_id, target_staff_id, target_command_id,
      jsonb_build_object(
        'closed', false,
        'shiftId', open_shift.id,
        'differenceCents', difference
      )
    );
  end if;

  select count(*)::integer, coalesce(sum(pending), 0)::integer
  into pending_count, pending_total
  from (
    select (private.account_summary(
      target_tenant_id, target_location_id, account_session.id
    ) ->> 'pendingCents')::integer as pending
    from private.table_sessions account_session
    where account_session.tenant_id = target_tenant_id
      and account_session.location_id = target_location_id
      and account_session.status = 'open'
  ) balances
  where pending > 0;
  breakdown := private.cash_shift_breakdown(
    target_tenant_id, target_location_id, open_shift.id
  );

  insert into private.cash_shift_closures (
    tenant_id, location_id, shift_id, closed_by, counted_cash_cents,
    expected_cash_cents, difference_cents, reason, pending_accounts,
    pending_cents, breakdown, command_id
  ) values (
    target_tenant_id, target_location_id, open_shift.id, target_staff_id,
    target_counted_cash_cents, expected, difference, clean_reason,
    pending_count, pending_total, breakdown, target_command_id
  );
  update private.cash_shifts shift
  set status = 'closed', closed_at = now()
  where shift.tenant_id = target_tenant_id
    and shift.location_id = target_location_id
    and shift.id = open_shift.id;
  perform private.append_audit_event(
    target_tenant_id, 'staff', target_staff_id, 'cash_shift.closed',
    'Caja cerrada por el encargado', 'cash:' || gen_random_uuid()::text,
    'cash_shift', open_shift.id
  );

  return private.finish_waiter_command(
    target_tenant_id, target_location_id, target_staff_id, target_command_id,
    jsonb_build_object(
      'closed', true,
      'shiftId', open_shift.id,
      'countedCashCents', target_counted_cash_cents,
      'expectedCashCents', expected,
      'differenceCents', difference,
      'reason', clean_reason,
      'pendingAccounts', pending_count,
      'pendingCents', pending_total,
      'breakdown', breakdown
    )
  );
end;
$$;

-- 4. Collecting now needs an open register ----------------------------------------------------

create or replace function private.record_account_payment(
  target_tenant_id uuid,
  target_location_id uuid,
  target_staff_id uuid,
  target_command_id uuid,
  target_session_id uuid,
  target_method text,
  target_amount_cents integer,
  target_tip_cents integer
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
  tip integer := coalesce(target_tip_cents, 0);
  pending integer;
  pay integer;
  payment_id uuid := gen_random_uuid();
  open_shift uuid;
begin
  stored := private.claim_waiter_command(
    target_tenant_id, target_location_id, target_staff_id, target_command_id,
    jsonb_build_object(
      'kind', 'account_payment', 'sessionId', target_session_id,
      'method', target_method, 'amountCents', target_amount_cents,
      'tipCents', target_tip_cents
    )
  );
  if stored is not null then
    return stored;
  end if;
  if target_method not in ('cash', 'credit_card', 'debit_card', 'other_in_person')
    or (target_amount_cents is not null and target_amount_cents <= 0)
    or tip < 0 or tip > 100000000
  then
    raise exception 'invalid payment' using errcode = 'PT212';
  end if;

  perform 1 from private.table_sessions account_session
  where account_session.tenant_id = target_tenant_id
    and account_session.location_id = target_location_id
    and account_session.id = target_session_id
  for update;
  if not found
    or not private.waiter_serves_session(
      target_tenant_id, target_location_id, target_staff_id, actor_role,
      target_session_id
    )
  then
    raise exception 'account not found' using errcode = 'PT201';
  end if;
  open_shift := private.current_cash_shift_id(target_tenant_id, target_location_id);
  if open_shift is null then
    raise exception 'the register is closed' using errcode = 'PT240';
  end if;

  pending := (private.account_summary(
    target_tenant_id, target_location_id, target_session_id
  ) ->> 'pendingCents')::integer;
  if pending <= 0 then
    raise exception 'nothing to collect' using errcode = 'PT231';
  end if;
  pay := coalesce(target_amount_cents, pending);
  if pay > pending then
    raise exception 'the payment exceeds the pending balance' using errcode = 'PT230';
  end if;

  if tip > 0 then
    insert into private.account_entries (
      tenant_id, location_id, session_id, kind, amount_cents, origin, cause,
      source_type, source_id, actor_type, actor_id, command_id, shift_id
    ) values (
      target_tenant_id, target_location_id, target_session_id, 'tip', tip,
      'payment', 'Propina', 'payment', payment_id, 'staff', target_staff_id,
      target_command_id, open_shift
    );
  end if;
  insert into private.account_entries (
    tenant_id, location_id, session_id, kind, amount_cents, origin, cause,
    source_type, source_id, actor_type, actor_id, payment_method, command_id,
    shift_id
  ) values (
    target_tenant_id, target_location_id, target_session_id, 'payment',
    -(pay + tip), 'payment', 'Cobro presencial', 'payment', payment_id,
    'staff', target_staff_id, target_method, target_command_id, open_shift
  );
  perform private.append_audit_event(
    target_tenant_id, 'staff', target_staff_id, 'account.payment_recorded',
    'Cobro presencial registrado en la cuenta', 'account:' || gen_random_uuid()::text,
    'table_session', target_session_id
  );

  return private.finish_waiter_command(
    target_tenant_id, target_location_id, target_staff_id, target_command_id,
    jsonb_build_object(
      'sessionId', target_session_id,
      'paymentId', payment_id,
      'shiftId', open_shift,
      'amountCents', pay,
      'tipCents', tip,
      'paymentCents', pay + tip,
      'pendingCents', pending - pay
    )
  );
end;
$$;

-- 5. Refunds -----------------------------------------------------------------------------------------

-- Returns money to the diner. Only a manager does it, only against an open
-- register, only up to the credit the account owes the diner, and always pointing
-- at the payment it returns (and optionally the item that caused it).
create function private.record_account_refund(
  target_tenant_id uuid,
  target_location_id uuid,
  target_staff_id uuid,
  target_command_id uuid,
  target_session_id uuid,
  target_payment_id uuid,
  target_amount_cents integer,
  target_item_line_id uuid,
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
  actor_role text;
  stored jsonb;
  clean_reason text;
  payment_entry private.account_entries%rowtype;
  open_shift uuid;
  credit integer;
  refundable integer;
  refund_id uuid := gen_random_uuid();
begin
  select member.role into actor_role
  from public.staff_members member
  where member.tenant_id = target_tenant_id
    and member.location_id = target_location_id
    and member.id = target_staff_id
    and member.is_active;
  if actor_role is null then
    raise exception 'staff member cannot operate the salon' using errcode = 'PT200';
  end if;
  if actor_role <> 'manager' then
    raise exception 'only a manager can refund' using errcode = 'PT222';
  end if;

  stored := private.claim_waiter_command(
    target_tenant_id, target_location_id, target_staff_id, target_command_id,
    jsonb_build_object(
      'kind', 'account_refund', 'sessionId', target_session_id,
      'paymentId', target_payment_id, 'amountCents', target_amount_cents,
      'itemLineId', target_item_line_id, 'reason', target_reason
    )
  );
  if stored is not null then
    return stored;
  end if;
  clean_reason := private.required_reason(target_reason);
  if target_amount_cents is null or target_amount_cents <= 0 then
    raise exception 'invalid refund' using errcode = 'PT212';
  end if;

  perform 1 from private.table_sessions account_session
  where account_session.tenant_id = target_tenant_id
    and account_session.location_id = target_location_id
    and account_session.id = target_session_id
    and account_session.status = 'open'
  for update;
  if not found then
    raise exception 'account not found' using errcode = 'PT201';
  end if;
  open_shift := private.current_cash_shift_id(target_tenant_id, target_location_id);
  if open_shift is null then
    raise exception 'the register is closed' using errcode = 'PT240';
  end if;

  select * into payment_entry
  from private.account_entries entry
  where entry.tenant_id = target_tenant_id
    and entry.location_id = target_location_id
    and entry.session_id = target_session_id
    and entry.kind = 'payment'
    and entry.source_id = target_payment_id;
  if not found then
    raise exception 'payment not found' using errcode = 'PT201';
  end if;
  if target_item_line_id is not null and not exists (
    select 1
    from private.confirmed_order_items item
    join private.confirmed_orders confirmed
      on confirmed.tenant_id = item.tenant_id
      and confirmed.location_id = item.location_id
      and confirmed.id = item.order_id
    where item.tenant_id = target_tenant_id
      and item.location_id = target_location_id
      and item.line_id = target_item_line_id
      and confirmed.session_id = target_session_id
  ) then
    raise exception 'item not found' using errcode = 'PT201';
  end if;

  credit := -(private.account_summary(
    target_tenant_id, target_location_id, target_session_id
  ) ->> 'pendingCents')::integer;
  if target_amount_cents > greatest(credit, 0) then
    raise exception 'the refund exceeds the credit of the account' using errcode = 'PT242';
  end if;
  refundable := -payment_entry.amount_cents - coalesce((
    select sum(entry.amount_cents)
    from private.account_entries entry
    where entry.tenant_id = target_tenant_id
      and entry.location_id = target_location_id
      and entry.kind = 'refund'
      and entry.refund_of_source_id = target_payment_id
  ), 0)::integer;
  if target_amount_cents > refundable then
    raise exception 'the refund exceeds the payment' using errcode = 'PT242';
  end if;

  insert into private.account_entries (
    tenant_id, location_id, session_id, kind, amount_cents, origin, cause,
    source_type, source_id, actor_type, actor_id, payment_method, command_id,
    shift_id, refund_of_source_id, item_line_id
  ) values (
    target_tenant_id, target_location_id, target_session_id, 'refund',
    target_amount_cents, 'refund', 'Devolución: ' || clean_reason, 'refund',
    refund_id, 'staff', target_staff_id, payment_entry.payment_method,
    target_command_id, open_shift, target_payment_id, target_item_line_id
  );
  perform private.append_audit_event(
    target_tenant_id, 'staff', target_staff_id, 'account.refund_recorded',
    'Devolución presencial registrada', 'account:' || gen_random_uuid()::text,
    'table_session', target_session_id
  );

  return private.finish_waiter_command(
    target_tenant_id, target_location_id, target_staff_id, target_command_id,
    jsonb_build_object(
      'sessionId', target_session_id,
      'paymentId', target_payment_id,
      'refundCents', target_amount_cents,
      'shiftId', open_shift,
      'pendingCents', (private.account_summary(
        target_tenant_id, target_location_id, target_session_id
      ) ->> 'pendingCents')::integer
    )
  );
end;
$$;

-- 6. Register view -----------------------------------------------------------------------------------

-- Everyone who collects sees whether the register is open. While it is open
-- nobody sees what the drawer should hold: that is revealed only after closing.
create function private.cash_register_view(
  target_tenant_id uuid,
  target_location_id uuid,
  target_staff_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_role text := private.waiter_actor_role(
    target_tenant_id, target_location_id, target_staff_id
  );
  open_shift private.cash_shifts%rowtype;
  can_manage boolean := actor_role = 'manager';
  register jsonb;
begin
  select * into open_shift
  from private.cash_shifts shift
  where shift.tenant_id = target_tenant_id
    and shift.location_id = target_location_id
    and shift.status = 'open';
  if found then
    register := jsonb_build_object(
      'open', true,
      'shiftId', open_shift.id,
      'openedAt', open_shift.opened_at,
      'openedByName', (
        select member.display_name from public.staff_members member
        where member.tenant_id = open_shift.tenant_id and member.id = open_shift.opened_by
      ),
      'openingCashCents', open_shift.opening_cash_cents,
      'paymentCount', (
        select count(*)::integer from private.account_entries entry
        where entry.tenant_id = target_tenant_id
          and entry.location_id = target_location_id
          and entry.shift_id = open_shift.id and entry.kind = 'payment'
      ),
      'refundCount', (
        select count(*)::integer from private.account_entries entry
        where entry.tenant_id = target_tenant_id
          and entry.location_id = target_location_id
          and entry.shift_id = open_shift.id and entry.kind = 'refund'
      ),
      'movements', case when can_manage then coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', movement.id, 'kind', movement.kind,
          'amountCents', movement.amount_cents, 'reason', movement.reason,
          'createdAt', movement.created_at
        ) order by movement.created_at, movement.id)
        from private.cash_movements movement
        where movement.tenant_id = target_tenant_id
          and movement.location_id = target_location_id
          and movement.shift_id = open_shift.id
      ), '[]'::jsonb) else '[]'::jsonb end
    );
  else
    register := jsonb_build_object('open', false);
  end if;

  return jsonb_build_object(
    'canManage', can_manage,
    'register', register,
    'closures', case when can_manage then coalesce((
      select jsonb_agg(jsonb_build_object(
        'shiftId', closure.shift_id,
        'openedAt', shift.opened_at,
        'closedAt', closure.closed_at,
        'openedByName', opener.display_name,
        'closedByName', closer.display_name,
        'openingCashCents', shift.opening_cash_cents,
        'countedCashCents', closure.counted_cash_cents,
        'expectedCashCents', closure.expected_cash_cents,
        'differenceCents', closure.difference_cents,
        'reason', closure.reason,
        'pendingAccounts', closure.pending_accounts,
        'pendingCents', closure.pending_cents,
        'breakdown', closure.breakdown
      ) order by closure.closed_at desc, closure.shift_id)
      from (
        select * from private.cash_shift_closures recent
        where recent.tenant_id = target_tenant_id
          and recent.location_id = target_location_id
        order by recent.closed_at desc, recent.shift_id
        limit 10
      ) closure
      join private.cash_shifts shift
        on shift.tenant_id = closure.tenant_id
        and shift.location_id = closure.location_id
        and shift.id = closure.shift_id
      join public.staff_members opener
        on opener.tenant_id = shift.tenant_id and opener.id = shift.opened_by
      join public.staff_members closer
        on closer.tenant_id = closure.tenant_id and closer.id = closure.closed_by
    ), '[]'::jsonb) else '[]'::jsonb end
  );
end;
$$;

-- 7. The accounts view reports the register and the payment ids ------------------------------------
-- Patches two spots of the T22 definition instead of copying the whole function;
-- it fails loudly if either is not found.
do $patch$
declare
  definition text;
begin
  select pg_get_functiondef('private.waiter_accounts_view(uuid,uuid,uuid)'::regprocedure)
  into definition;
  if position($e$select jsonb_build_object('accounts', coalesce(($e$ in definition) = 0
    or position($e$'paymentMethod', entry.payment_method,$e$ in definition) = 0
  then
    raise exception 'waiter_accounts_view no longer has the T22 anchors';
  end if;
  definition := replace(
    definition,
    $e$select jsonb_build_object('accounts', coalesce(($e$,
    $e$select jsonb_build_object(
    'cashRegisterOpen', private.current_cash_shift_id(
      target_tenant_id, target_location_id) is not null,
    'accounts', coalesce(($e$
  );
  definition := replace(
    definition,
    $e$'paymentMethod', entry.payment_method,$e$,
    $e$'paymentMethod', entry.payment_method,
          'sourceId', entry.source_id,$e$
  );
  execute definition;
end
$patch$;

-- 8. Privileges ----------------------------------------------------------------------------------------

revoke all on function
  private.guard_cash_shift_change(),
  private.current_cash_shift_id(uuid, uuid),
  private.open_cash_shift(uuid, uuid, uuid, uuid, integer),
  private.record_cash_movement(uuid, uuid, uuid, uuid, text, integer, text),
  private.cash_shift_breakdown(uuid, uuid, uuid),
  private.expected_cash_cents(uuid, uuid, uuid),
  private.close_cash_shift(uuid, uuid, uuid, uuid, integer, text),
  private.record_account_refund(uuid, uuid, uuid, uuid, uuid, uuid, integer, uuid, text),
  private.cash_register_view(uuid, uuid, uuid)
from public, anon, authenticated;

grant execute on function
  private.open_cash_shift(uuid, uuid, uuid, uuid, integer),
  private.record_cash_movement(uuid, uuid, uuid, uuid, text, integer, text),
  private.close_cash_shift(uuid, uuid, uuid, uuid, integer, text),
  private.record_account_refund(uuid, uuid, uuid, uuid, uuid, uuid, integer, uuid, text),
  private.cash_register_view(uuid, uuid, uuid)
to authenticator;

commit;
