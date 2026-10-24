begin;

-- Table accounts (T22): a table session and an append-only ledger.
--
-- Confirming the first order of a table (or of a table group) opens ONE session
-- and marks the table occupied. Every amount that touches the account is a
-- movement in `account_entries`: charges for confirmed items, reversals for
-- cancelled or replaced items, discounts, tips and in-person payments. Nothing
-- stores a balance: consumed, discounts, tips, paid and pending are always
-- derived from the ledger, and the consumption can be recomputed from the
-- confirmed items and their adjustments to prove the two agree.
--
-- Cash registers, shifts and blind counts (T23), online payments (T24) and
-- splitting or partial charging by person (T25) are not here. Orders confirmed
-- before this migration keep no account (local development data only).

-- 1. Table sessions ------------------------------------------------------------------

create table private.table_sessions (
  id uuid not null default gen_random_uuid(),
  tenant_id uuid not null,
  location_id uuid not null,
  -- The group id when the table belongs to a group, otherwise the table id: one
  -- open account per group, or per loose table.
  scope_key uuid not null,
  table_id uuid not null,
  group_id uuid,
  status text not null default 'open' check (status in ('open', 'closed')),
  opened_by uuid not null,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  primary key (tenant_id, location_id, id),
  foreign key (tenant_id, location_id)
    references public.locations(tenant_id, id) on delete cascade,
  foreign key (tenant_id, opened_by)
    references public.staff_members(tenant_id, id) on delete restrict,
  check ((status = 'closed') = (closed_at is not null))
);

create unique index table_sessions_one_open_idx
  on private.table_sessions (tenant_id, location_id, scope_key)
  where status = 'open';

alter table private.confirmed_orders
  add column session_id uuid,
  add constraint confirmed_orders_session_fkey
    foreign key (tenant_id, location_id, session_id)
    references private.table_sessions(tenant_id, location_id, id)
    on delete restrict;

-- A session is never deleted; its only change is being closed (table release,
-- T26).
create function private.guard_table_session_change()
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

create trigger table_sessions_guard_change
before update or delete on private.table_sessions
for each row execute function private.guard_table_session_change();
create trigger table_sessions_no_truncate
before truncate on private.table_sessions
for each statement execute function private.reject_append_only_change();

-- 2. Ledger ----------------------------------------------------------------------------------

create table private.account_entries (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  location_id uuid not null,
  session_id uuid not null,
  order_id uuid,
  -- Positive amounts raise what the table owes (charge, tip, refund); negative
  -- ones lower it (discount, payment). An adjustment reverses a charge.
  kind text not null
    check (kind in ('charge', 'discount', 'payment', 'tip', 'adjustment', 'refund')),
  amount_cents integer not null check (amount_cents <> 0),
  currency text not null default 'ARS' check (currency ~ '^[A-Z]{3}$'),
  origin text not null check (
    origin in (
      'order_confirmed', 'item_cancelled', 'item_replaced', 'payment',
      'discount', 'manual'
    )
  ),
  cause text not null check (length(btrim(cause)) between 1 and 200),
  source_type text not null check (
    source_type in ('confirmed_order_item', 'order_adjustment', 'payment', 'discount')
  ),
  source_id uuid not null,
  actor_type text not null check (actor_type in ('staff', 'system')),
  actor_id uuid,
  payment_method text
    check (payment_method in ('cash', 'credit_card', 'debit_card', 'other_in_person')),
  command_id uuid,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, location_id, session_id)
    references private.table_sessions(tenant_id, location_id, id) on delete restrict,
  foreign key (tenant_id, actor_id)
    references public.staff_members(tenant_id, id) on delete restrict,
  check (kind not in ('charge', 'tip', 'refund') or amount_cents > 0),
  check (kind not in ('discount', 'payment') or amount_cents < 0),
  check (payment_method is null or kind in ('payment', 'refund')),
  check (kind <> 'payment' or payment_method is not null),
  check ((actor_type = 'staff') = (actor_id is not null))
);

-- One movement per source and kind: a retry can never charge an item twice.
create unique index account_entries_source_idx
  on private.account_entries (
    tenant_id, location_id, session_id, kind, source_type, source_id,
    coalesce(order_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
create index account_entries_session_idx
  on private.account_entries (tenant_id, location_id, session_id, id);

create trigger account_entries_append_only
before update or delete on private.account_entries
for each row execute function private.reject_append_only_change();
create trigger account_entries_no_truncate
before truncate on private.account_entries
for each statement execute function private.reject_append_only_change();

create table private.account_decisions (
  tenant_id uuid not null,
  location_id uuid not null,
  session_id uuid not null,
  command_id uuid not null,
  decision text not null check (decision in ('keep_open')),
  decided_by uuid not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, location_id, session_id, command_id),
  foreign key (tenant_id, location_id, session_id)
    references private.table_sessions(tenant_id, location_id, id) on delete restrict,
  foreign key (tenant_id, decided_by)
    references public.staff_members(tenant_id, id) on delete restrict
);

create trigger account_decisions_append_only
before update or delete on private.account_decisions
for each row execute function private.reject_append_only_change();
create trigger account_decisions_no_truncate
before truncate on private.account_decisions
for each statement execute function private.reject_append_only_change();

revoke all on table
  private.table_sessions, private.account_entries, private.account_decisions
from public, anon, authenticated, authenticator;

-- 3. Opening the session -------------------------------------------------------------------

-- Returns the open session of the table (or of its group), opening it and marking
-- the table occupied when there is none. Two simultaneous confirmations race on
-- the partial unique index and end up on the same session.
create function private.ensure_table_session(
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

create function private.assign_order_session()
returns trigger
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
begin
  new.session_id := private.ensure_table_session(
    new.tenant_id, new.location_id, new.table_id, new.confirmed_by
  );
  return new;
end;
$$;

create trigger confirmed_orders_assign_session
before insert on private.confirmed_orders
for each row execute function private.assign_order_session();

-- 4. Charges and reversals -------------------------------------------------------------------

-- Every confirmed item is charged once, replacements included.
create function private.charge_confirmed_item()
returns trigger
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  order_row private.confirmed_orders%rowtype;
begin
  if new.total_cents <= 0 then
    return new;
  end if;
  select * into order_row
  from private.confirmed_orders confirmed
  where confirmed.tenant_id = new.tenant_id
    and confirmed.location_id = new.location_id
    and confirmed.id = new.order_id;
  if order_row.session_id is null then
    return new;
  end if;
  insert into private.account_entries (
    tenant_id, location_id, session_id, order_id, kind, amount_cents, origin,
    cause, source_type, source_id, actor_type, actor_id, command_id
  ) values (
    new.tenant_id, new.location_id, order_row.session_id, new.order_id, 'charge',
    new.total_cents, 'order_confirmed',
    'Ítem confirmado: ' || left(new.title, 160), 'confirmed_order_item',
    new.line_id, 'staff', order_row.confirmed_by, order_row.command_id
  );
  return new;
end;
$$;

create trigger confirmed_order_items_charge
after insert on private.confirmed_order_items
for each row execute function private.charge_confirmed_item();

-- A cancellation, or an accepted replacement, reverses the original charge.
create function private.reverse_adjusted_item()
returns trigger
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  order_row private.confirmed_orders%rowtype;
  entry_origin text;
  entry_cause text;
begin
  if tg_op = 'INSERT' and new.kind = 'cancellation' then
    entry_origin := 'item_cancelled';
    entry_cause := 'Ítem cancelado: ' || left(coalesce(new.reason, 'sin motivo'), 160);
  elsif tg_op = 'UPDATE' and new.kind = 'replacement'
    and old.status = 'proposed' and new.status = 'accepted' then
    entry_origin := 'item_replaced';
    entry_cause := 'Ítem reemplazado por ' || left(coalesce(new.replacement_title, ''), 150);
  else
    return new;
  end if;
  if new.original_total_cents <= 0 then
    return new;
  end if;
  select * into order_row
  from private.confirmed_orders confirmed
  where confirmed.tenant_id = new.tenant_id
    and confirmed.location_id = new.location_id
    and confirmed.id = new.order_id;
  if order_row.session_id is null then
    return new;
  end if;
  insert into private.account_entries (
    tenant_id, location_id, session_id, order_id, kind, amount_cents, origin,
    cause, source_type, source_id, actor_type, actor_id, command_id
  ) values (
    new.tenant_id, new.location_id, order_row.session_id, new.order_id,
    'adjustment', -new.original_total_cents, entry_origin, entry_cause,
    'order_adjustment', new.id, 'staff',
    coalesce(new.decided_by, new.proposed_by),
    coalesce(new.decided_command_id, new.proposed_command_id)
  );
  return new;
end;
$$;

create trigger order_adjustments_reverse_item
after insert or update on private.order_adjustments
for each row execute function private.reverse_adjusted_item();

-- 5. Derived balance -------------------------------------------------------------------------

create function private.account_summary(
  target_tenant_id uuid,
  target_location_id uuid,
  target_session_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select jsonb_build_object(
    'consumedCents', coalesce(sum(entry.amount_cents)
      filter (where entry.kind in ('charge', 'adjustment')), 0)::integer,
    'discountCents', -coalesce(sum(entry.amount_cents)
      filter (where entry.kind = 'discount'), 0)::integer,
    'tipCents', coalesce(sum(entry.amount_cents)
      filter (where entry.kind = 'tip'), 0)::integer,
    'paidCents', -coalesce(sum(entry.amount_cents)
      filter (where entry.kind = 'payment'), 0)::integer,
    'refundedCents', coalesce(sum(entry.amount_cents)
      filter (where entry.kind = 'refund'), 0)::integer,
    'pendingCents', coalesce(sum(entry.amount_cents), 0)::integer
  )
  from private.account_entries entry
  where entry.tenant_id = target_tenant_id
    and entry.location_id = target_location_id
    and entry.session_id = target_session_id;
$$;

-- Recomputes the consumption from the confirmed items and their adjustments,
-- without reading the ledger, and compares it with the ledger.
create function private.verify_account(
  target_tenant_id uuid,
  target_location_id uuid,
  target_session_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  with ledger as (
    select private.account_summary(
      target_tenant_id, target_location_id, target_session_id
    ) as summary
  ),
  recomputed as (
    select
      (select coalesce(sum(item.total_cents), 0)
       from private.confirmed_order_items item
       join private.confirmed_orders confirmed
         on confirmed.tenant_id = item.tenant_id
         and confirmed.location_id = item.location_id
         and confirmed.id = item.order_id
       where confirmed.tenant_id = target_tenant_id
         and confirmed.location_id = target_location_id
         and confirmed.session_id = target_session_id)
      - (select coalesce(sum(adjustment.original_total_cents), 0)
         from private.order_adjustments adjustment
         join private.confirmed_orders confirmed
           on confirmed.tenant_id = adjustment.tenant_id
           and confirmed.location_id = adjustment.location_id
           and confirmed.id = adjustment.order_id
         where confirmed.tenant_id = target_tenant_id
           and confirmed.location_id = target_location_id
           and confirmed.session_id = target_session_id
           and (adjustment.kind = 'cancellation'
             or (adjustment.kind = 'replacement' and adjustment.status = 'accepted')))
      as consumed
  )
  select jsonb_build_object(
    'matches', (ledger.summary ->> 'consumedCents')::bigint = recomputed.consumed
      and (ledger.summary ->> 'pendingCents')::bigint
        = (ledger.summary ->> 'consumedCents')::bigint
          - (ledger.summary ->> 'discountCents')::bigint
          + (ledger.summary ->> 'tipCents')::bigint
          - (ledger.summary ->> 'paidCents')::bigint
          + (ledger.summary ->> 'refundedCents')::bigint,
    'ledger', ledger.summary,
    'recomputedConsumedCents', recomputed.consumed
  )
  from ledger, recomputed;
$$;

-- Half-up rounding to the cent: 12.5% of 1,001 cents is 125.125 -> 125.
create function private.discount_cents_for_percent(
  target_base_cents integer,
  target_basis_points integer
)
returns integer
language sql
immutable
set search_path = ''
as $$
  select ((target_base_cents::bigint * target_basis_points + 5000) / 10000)::integer;
$$;

-- Account of the session of a table the actor may operate: a waiter serves a
-- session if they serve at least one of its tables.
create function private.waiter_serves_session(
  target_tenant_id uuid,
  target_location_id uuid,
  target_staff_id uuid,
  target_role text,
  target_session_id uuid
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
    from private.table_sessions account_session
    where account_session.tenant_id = target_tenant_id
      and account_session.location_id = target_location_id
      and account_session.id = target_session_id
      and account_session.status = 'open'
      and (
        private.waiter_serves_table(
          target_tenant_id, target_location_id, target_staff_id, target_role,
          account_session.table_id
        )
        or exists (
          select 1
          from private.floor_group_members member
          where member.tenant_id = account_session.tenant_id
            and member.location_id = account_session.location_id
            and member.group_id = account_session.group_id
            and private.waiter_serves_table(
              target_tenant_id, target_location_id, target_staff_id,
              target_role, member.table_id
            )
        )
      )
  );
$$;

-- 6. Waiter view --------------------------------------------------------------------------------

create function private.waiter_accounts_view(
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
  result jsonb;
begin
  select jsonb_build_object('accounts', coalesce((
    select jsonb_agg(jsonb_build_object(
      'sessionId', account_session.id,
      'tableId', account_session.table_id,
      'tableLabels', (
        select jsonb_agg(floor_table.label order by floor_table.position)
        from private.floor_tables floor_table
        where floor_table.tenant_id = account_session.tenant_id
          and floor_table.location_id = account_session.location_id
          and (
            floor_table.id = account_session.table_id
            or floor_table.id in (
              select member.table_id
              from private.floor_group_members member
              where member.tenant_id = account_session.tenant_id
                and member.location_id = account_session.location_id
                and member.group_id = account_session.group_id
            )
          )
      ),
      'openedAt', account_session.opened_at,
      'currency', 'ARS',
      'summary', private.account_summary(
        target_tenant_id, target_location_id, account_session.id
      ),
      'keptOpen', exists (
        select 1 from private.account_decisions decision
        where decision.tenant_id = account_session.tenant_id
          and decision.location_id = account_session.location_id
          and decision.session_id = account_session.id
      ),
      'entries', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', entry.id,
          'kind', entry.kind,
          'amountCents', entry.amount_cents,
          'origin', entry.origin,
          'cause', entry.cause,
          'paymentMethod', entry.payment_method,
          'createdAt', entry.created_at
        ) order by entry.id)
        from (
          select * from private.account_entries recent
          where recent.tenant_id = account_session.tenant_id
            and recent.location_id = account_session.location_id
            and recent.session_id = account_session.id
          order by recent.id desc
          limit 60
        ) entry
      ), '[]'::jsonb)
    ) order by account_session.opened_at, account_session.id)
    from private.table_sessions account_session
    where account_session.tenant_id = target_tenant_id
      and account_session.location_id = target_location_id
      and account_session.status = 'open'
      and private.waiter_serves_session(
        target_tenant_id, target_location_id, target_staff_id, actor_role,
        account_session.id
      )
  ), '[]'::jsonb)) into result;
  return result;
end;
$$;

-- 7. Collecting, discounting and leaving the account open --------------------------------------

create function private.record_account_payment(
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
      source_type, source_id, actor_type, actor_id, command_id
    ) values (
      target_tenant_id, target_location_id, target_session_id, 'tip', tip,
      'payment', 'Propina', 'payment', payment_id, 'staff', target_staff_id,
      target_command_id
    );
  end if;
  insert into private.account_entries (
    tenant_id, location_id, session_id, kind, amount_cents, origin, cause,
    source_type, source_id, actor_type, actor_id, payment_method, command_id
  ) values (
    target_tenant_id, target_location_id, target_session_id, 'payment',
    -(pay + tip), 'payment', 'Cobro presencial', 'payment', payment_id,
    'staff', target_staff_id, target_method, target_command_id
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
      'amountCents', pay,
      'tipCents', tip,
      'paymentCents', pay + tip,
      'pendingCents', pending - pay
    )
  );
end;
$$;

-- Only a manager grants a discount, by amount or by percentage of the pending
-- balance (in basis points, rounded half up), always with a reason.
create function private.apply_account_discount(
  target_tenant_id uuid,
  target_location_id uuid,
  target_staff_id uuid,
  target_command_id uuid,
  target_session_id uuid,
  target_kind text,
  target_value integer,
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
  pending integer;
  discount integer;
  discount_id uuid := gen_random_uuid();
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
    raise exception 'only a manager can grant a discount' using errcode = 'PT222';
  end if;

  stored := private.claim_waiter_command(
    target_tenant_id, target_location_id, target_staff_id, target_command_id,
    jsonb_build_object(
      'kind', 'account_discount', 'sessionId', target_session_id,
      'discountKind', target_kind, 'value', target_value, 'reason', target_reason
    )
  );
  if stored is not null then
    return stored;
  end if;
  clean_reason := private.required_reason(target_reason);
  if target_kind not in ('amount', 'percent')
    or target_value is null or target_value <= 0
    or (target_kind = 'percent' and target_value > 10000)
  then
    raise exception 'invalid discount' using errcode = 'PT212';
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

  pending := (private.account_summary(
    target_tenant_id, target_location_id, target_session_id
  ) ->> 'pendingCents')::integer;
  discount := case
    when target_kind = 'amount' then target_value
    else private.discount_cents_for_percent(pending, target_value)
  end;
  if discount <= 0 then
    raise exception 'invalid discount' using errcode = 'PT212';
  end if;
  if discount > pending then
    raise exception 'the discount exceeds the pending balance' using errcode = 'PT232';
  end if;

  insert into private.account_entries (
    tenant_id, location_id, session_id, kind, amount_cents, origin, cause,
    source_type, source_id, actor_type, actor_id, command_id
  ) values (
    target_tenant_id, target_location_id, target_session_id, 'discount',
    -discount, 'discount', 'Descuento: ' || clean_reason, 'discount',
    discount_id, 'staff', target_staff_id, target_command_id
  );
  perform private.append_audit_event(
    target_tenant_id, 'staff', target_staff_id, 'account.discount_applied',
    'Descuento aplicado a la cuenta', 'account:' || gen_random_uuid()::text,
    'table_session', target_session_id
  );

  return private.finish_waiter_command(
    target_tenant_id, target_location_id, target_staff_id, target_command_id,
    jsonb_build_object(
      'sessionId', target_session_id,
      'discountCents', discount,
      'pendingCents', pending - discount
    )
  );
end;
$$;

-- "Dejar cuenta abierta" is a decision of its own, separate from confirming the
-- order and from collecting: it records the choice and moves no money.
create function private.keep_account_open(
  target_tenant_id uuid,
  target_location_id uuid,
  target_staff_id uuid,
  target_command_id uuid,
  target_session_id uuid
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
begin
  stored := private.claim_waiter_command(
    target_tenant_id, target_location_id, target_staff_id, target_command_id,
    jsonb_build_object('kind', 'keep_account_open', 'sessionId', target_session_id)
  );
  if stored is not null then
    return stored;
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
  insert into private.account_decisions (
    tenant_id, location_id, session_id, command_id, decision, decided_by
  ) values (
    target_tenant_id, target_location_id, target_session_id,
    target_command_id, 'keep_open', target_staff_id
  );
  perform private.append_audit_event(
    target_tenant_id, 'staff', target_staff_id, 'account.kept_open',
    'Cuenta dejada abierta por el personal', 'account:' || gen_random_uuid()::text,
    'table_session', target_session_id
  );
  return private.finish_waiter_command(
    target_tenant_id, target_location_id, target_staff_id, target_command_id,
    jsonb_build_object(
      'sessionId', target_session_id,
      'decision', 'keep_open',
      'pendingCents', (private.account_summary(
        target_tenant_id, target_location_id, target_session_id
      ) ->> 'pendingCents')::integer
    )
  );
end;
$$;

-- 8. The salon view now reports each unit's session and balance -----------------------------
-- Patches two lines of the T19 definition instead of copying the whole function;
-- it fails loudly if either line is not found.
do $patch$
declare
  definition text;
  session_expression constant text :=
    $e$'session', (select jsonb_build_object('id', account_session.id)
      from private.table_sessions account_session
      where account_session.tenant_id = target_tenant_id
        and account_session.location_id = target_location_id
        and account_session.status = 'open'
        and account_session.scope_key = units.id),$e$;
  balance_expression constant text :=
    $e$'balanceCents', (select (private.account_summary(
        target_tenant_id, target_location_id, account_session.id) ->> 'pendingCents')::integer
      from private.table_sessions account_session
      where account_session.tenant_id = target_tenant_id
        and account_session.location_id = target_location_id
        and account_session.status = 'open'
        and account_session.scope_key = units.id),$e$;
begin
  select pg_get_functiondef('private.waiter_salon_view(uuid,uuid,uuid)'::regprocedure)
  into definition;
  if position($e$'session', null,$e$ in definition) = 0
    or position($e$'balanceCents', null,$e$ in definition) = 0
  then
    raise exception 'waiter_salon_view no longer has the T19 session placeholders';
  end if;
  definition := replace(definition, $e$'session', null,$e$, session_expression);
  definition := replace(definition, $e$'balanceCents', null,$e$, balance_expression);
  execute definition;
end
$patch$;

-- 9. Privileges ------------------------------------------------------------------------------------

revoke all on function
  private.guard_table_session_change(),
  private.ensure_table_session(uuid, uuid, uuid, uuid),
  private.assign_order_session(),
  private.charge_confirmed_item(),
  private.reverse_adjusted_item(),
  private.account_summary(uuid, uuid, uuid),
  private.verify_account(uuid, uuid, uuid),
  private.discount_cents_for_percent(integer, integer),
  private.waiter_serves_session(uuid, uuid, uuid, text, uuid),
  private.waiter_accounts_view(uuid, uuid, uuid),
  private.record_account_payment(uuid, uuid, uuid, uuid, uuid, text, integer, integer),
  private.apply_account_discount(uuid, uuid, uuid, uuid, uuid, text, integer, text),
  private.keep_account_open(uuid, uuid, uuid, uuid, uuid)
from public, anon, authenticated;

grant execute on function
  private.waiter_accounts_view(uuid, uuid, uuid),
  private.record_account_payment(uuid, uuid, uuid, uuid, uuid, text, integer, integer),
  private.apply_account_discount(uuid, uuid, uuid, uuid, uuid, text, integer, text),
  private.keep_account_open(uuid, uuid, uuid, uuid, uuid)
to authenticator;

commit;
