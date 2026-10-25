begin;

-- Closing a table, cleaning it and issuing the receipt (T26).
--
-- A settled account (balance exactly zero) can be closed. Closing never frees the
-- table: it moves every table of the session to "pending cleaning" and issues a
-- numbered, immutable, non-fiscal receipt. Only staff who serve the table (or a
-- manager) mark it clean, which is what makes it available again. "Avisar a caja"
-- stores an internal request with the table and the receipt, and nothing else:
-- no tax id, legal name or address is ever collected here.
--
-- Codes: PT270 balance not settled, PT271 an online payment still has to be
-- returned, PT272 already closed, PT273 closed ledger is frozen, PT274 table is
-- not pending cleaning, PT275 invalid table state change, PT276 no receipt yet.

-- 1. Table state machine ------------------------------------------------------------------

-- A table with no row is available. Only an occupied table can start waiting for
-- cleaning (or go out of service); a table that waits for cleaning can break; and
-- nothing but an explicit clean (the row is removed) makes it usable again. A
-- table never becomes occupied from cleaning or out of service: new sessions open
-- only on an available or occupied table.
create function private.guard_table_service_state_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.state is distinct from old.state
    and not (
      (old.state = 'occupied' and new.state in ('needs_cleaning', 'out_of_service'))
      or (old.state = 'needs_cleaning' and new.state = 'out_of_service')
    )
  then
    raise exception 'a table cannot go from % to %', old.state, new.state
      using errcode = 'PT275';
  end if;
  return new;
end;
$$;

create trigger floor_table_service_states_guard_change
before update on private.floor_table_service_states
for each row execute function private.guard_table_service_state_change();

-- 2. Receipts, counters and cashier requests ---------------------------------------------

create table private.receipt_counters (
  tenant_id uuid not null,
  location_id uuid not null,
  last_number integer not null check (last_number > 0),
  primary key (tenant_id, location_id),
  foreign key (tenant_id, location_id)
    references public.locations(tenant_id, id) on delete cascade
);

create table private.account_receipts (
  tenant_id uuid not null,
  location_id uuid not null,
  session_id uuid not null,
  number integer not null check (number > 0),
  issued_by uuid not null,
  issued_at timestamptz not null default now(),
  body jsonb not null,
  primary key (tenant_id, location_id, session_id),
  unique (tenant_id, location_id, number),
  foreign key (tenant_id, location_id, session_id)
    references private.table_sessions(tenant_id, location_id, id) on delete restrict,
  foreign key (tenant_id, issued_by)
    references public.staff_members(tenant_id, id) on delete restrict
);

create trigger account_receipts_append_only
before update or delete on private.account_receipts
for each row execute function private.reject_append_only_change();
create trigger account_receipts_no_truncate
before truncate on private.account_receipts
for each statement execute function private.reject_append_only_change();

-- An internal reminder for the cashier. It carries the session (so the table and
-- the receipt) and who asked; it has no room for fiscal data.
create table private.cashier_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  location_id uuid not null,
  session_id uuid not null,
  status text not null default 'open' check (status in ('open', 'resolved')),
  requested_by uuid not null,
  created_at timestamptz not null default now(),
  resolved_by uuid,
  resolved_at timestamptz,
  foreign key (tenant_id, location_id, session_id)
    references private.table_sessions(tenant_id, location_id, id) on delete restrict,
  foreign key (tenant_id, requested_by)
    references public.staff_members(tenant_id, id) on delete restrict,
  foreign key (tenant_id, resolved_by)
    references public.staff_members(tenant_id, id) on delete restrict,
  check ((status = 'resolved') = (resolved_at is not null and resolved_by is not null))
);

create unique index cashier_requests_one_open_idx
  on private.cashier_requests (tenant_id, location_id, session_id)
  where status = 'open';
create index cashier_requests_open_idx
  on private.cashier_requests (tenant_id, location_id, created_at)
  where status = 'open';

create function private.guard_cashier_request_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  movable constant text[] := array['status', 'resolved_by', 'resolved_at'];
begin
  if tg_op <> 'UPDATE'
    or old.status <> 'open'
    or new.status <> 'resolved'
    or (to_jsonb(new) - movable) is distinct from (to_jsonb(old) - movable)
  then
    raise exception 'a cashier request is only ever resolved' using errcode = 'PT209';
  end if;
  return new;
end;
$$;

create trigger cashier_requests_guard_change
before update or delete on private.cashier_requests
for each row execute function private.guard_cashier_request_change();
create trigger cashier_requests_no_truncate
before truncate on private.cashier_requests
for each statement execute function private.reject_append_only_change();

revoke all on table
  private.receipt_counters, private.account_receipts, private.cashier_requests
from public, anon, authenticated, authenticator;

-- 3. A closed account's ledger is frozen --------------------------------------------------

-- The only movement a closed account still accepts is a refund (money handed back
-- later by the provider). It waits for a concurrent close and then fails, so a
-- confirmation that raced the close cannot slip a charge into a closed account.
create function private.guard_closed_session_entry()
returns trigger
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
begin
  if new.kind = 'refund' then
    return new;
  end if;
  perform 1 from private.table_sessions account_session
  where account_session.tenant_id = new.tenant_id
    and account_session.location_id = new.location_id
    and account_session.id = new.session_id
    and account_session.status = 'open'
  for share;
  if not found then
    raise exception 'the account is closed' using errcode = 'PT273';
  end if;
  return new;
end;
$$;

create trigger account_entries_guard_closed_session
before insert on private.account_entries
for each row execute function private.guard_closed_session_entry();

-- 4. Who may see a session ------------------------------------------------------------------

-- Same reach as waiter_serves_session, but for a session in any state.
create function private.waiter_serves_any_session(
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

-- Every table the session covers: its own table and the members of its group.
create function private.session_table_ids(
  target_tenant_id uuid,
  target_location_id uuid,
  target_session_id uuid
)
returns uuid[]
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select coalesce(array_agg(distinct covered.table_id), '{}')
  from (
    select account_session.table_id
    from private.table_sessions account_session
    where account_session.tenant_id = target_tenant_id
      and account_session.location_id = target_location_id
      and account_session.id = target_session_id
    union
    select member.table_id
    from private.table_sessions account_session
    join private.floor_group_members member
      on member.tenant_id = account_session.tenant_id
      and member.location_id = account_session.location_id
      and member.group_id = account_session.group_id
    where account_session.tenant_id = target_tenant_id
      and account_session.location_id = target_location_id
      and account_session.id = target_session_id
  ) covered;
$$;

-- 5. The receipt ------------------------------------------------------------------------------

-- Built once, at close, from the ledger. Later movements (a refund that arrives
-- after the close) never rewrite it.
create function private.build_account_receipt(
  target_tenant_id uuid,
  target_location_id uuid,
  target_session_id uuid,
  target_number integer,
  target_opened_at timestamptz,
  target_closed_at timestamptz
)
returns jsonb
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select jsonb_build_object(
    'number', target_number,
    'sessionId', target_session_id,
    'notice', 'Comprobante de consumo — no válido como factura',
    'invoiceNotice', '¿Necesitás factura? Por el momento, la facturación se realiza en caja',
    'businessName', (select tenant.name from public.tenants tenant where tenant.id = target_tenant_id),
    'locationName', (select location.name from public.locations location
      where location.tenant_id = target_tenant_id and location.id = target_location_id),
    'tableLabels', (
      select coalesce(jsonb_agg(floor_table.label order by floor_table.position), '[]'::jsonb)
      from private.floor_tables floor_table
      where floor_table.tenant_id = target_tenant_id
        and floor_table.location_id = target_location_id
        and floor_table.id = any(private.session_table_ids(
          target_tenant_id, target_location_id, target_session_id))
    ),
    'openedAt', target_opened_at,
    'closedAt', target_closed_at,
    'currency', 'ARS',
    'items', private.account_live_items(target_tenant_id, target_location_id, target_session_id),
    'summary', private.account_summary(target_tenant_id, target_location_id, target_session_id),
    'discounts', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'cause', entry.cause, 'amountCents', -entry.amount_cents
      ) order by entry.id), '[]'::jsonb)
      from private.account_entries entry
      where entry.tenant_id = target_tenant_id
        and entry.location_id = target_location_id
        and entry.session_id = target_session_id
        and entry.kind = 'discount'
    ),
    -- What was handed over with each method, tip included.
    'payments', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'method', paid.method, 'amountCents', paid.cents
      ) order by paid.method), '[]'::jsonb)
      from (
        select entry.payment_method as method, (-sum(entry.amount_cents))::integer as cents
        from private.account_entries entry
        where entry.tenant_id = target_tenant_id
          and entry.location_id = target_location_id
          and entry.session_id = target_session_id
          and entry.kind = 'payment'
        group by entry.payment_method
      ) paid
    ),
    'refunds', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'method', returned.method, 'amountCents', returned.cents
      ) order by returned.method), '[]'::jsonb)
      from (
        select entry.payment_method as method, sum(entry.amount_cents)::integer as cents
        from private.account_entries entry
        where entry.tenant_id = target_tenant_id
          and entry.location_id = target_location_id
          and entry.session_id = target_session_id
          and entry.kind = 'refund'
        group by entry.payment_method
      ) returned
    )
  );
$$;

-- 6. Closing ---------------------------------------------------------------------------------

create function private.close_table_session(
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
  account_session private.table_sessions%rowtype;
  covered uuid[];
  pending integer;
  next_number integer;
  closing_time timestamptz := now();
  receipt jsonb;
begin
  stored := private.claim_waiter_command(
    target_tenant_id, target_location_id, target_staff_id, target_command_id,
    jsonb_build_object('kind', 'close_table_session', 'sessionId', target_session_id)
  );
  if stored is not null then
    return stored;
  end if;

  -- The same lock payments and confirmations take: a payment in flight finishes
  -- first, and one that arrives after finds the account closed.
  select * into account_session
  from private.table_sessions candidate
  where candidate.tenant_id = target_tenant_id
    and candidate.location_id = target_location_id
    and candidate.id = target_session_id
  for update;
  if not found
    or not private.waiter_serves_any_session(
      target_tenant_id, target_location_id, target_staff_id, actor_role,
      target_session_id
    )
  then
    raise exception 'account not found' using errcode = 'PT201';
  end if;
  if account_session.status <> 'open' then
    raise exception 'the account is already closed' using errcode = 'PT272';
  end if;

  pending := (private.account_summary(
    target_tenant_id, target_location_id, target_session_id
  ) ->> 'pendingCents')::integer;
  if pending <> 0 then
    raise exception 'the balance is not settled' using errcode = 'PT270';
  end if;

  covered := private.session_table_ids(
    target_tenant_id, target_location_id, target_session_id
  );
  -- Money that was charged and still has to be returned keeps the account open.
  if exists (
    select 1
    from private.online_payments attempt
    where attempt.tenant_id = target_tenant_id
      and attempt.location_id = target_location_id
      and attempt.fulfillment = 'needs_refund'
      and (
        attempt.session_id = target_session_id
        or exists (
          select 1 from private.account_splits split
          where split.id = attempt.share_split_id
            and split.session_id = target_session_id
        )
        or (
          attempt.intent_id is not null
          and attempt.created_at >= account_session.opened_at
          and exists (
            select 1 from private.order_intents intent
            where intent.tenant_id = attempt.tenant_id
              and intent.location_id = attempt.location_id
              and intent.id = attempt.intent_id
              and intent.table_id = any(covered)
          )
        )
      )
  ) then
    raise exception 'an online payment still has to be returned' using errcode = 'PT271';
  end if;

  -- A split nobody finished can no longer be paid once the account is closed.
  perform private.supersede_account_split(
    target_tenant_id, target_location_id, target_session_id
  );

  update private.table_sessions closing
  set status = 'closed', closed_at = closing_time
  where closing.tenant_id = target_tenant_id
    and closing.location_id = target_location_id
    and closing.id = target_session_id;

  -- Every table of the session waits for cleaning; one already out of service
  -- stays that way.
  insert into private.floor_table_service_states (
    tenant_id, location_id, table_id, state
  )
  select target_tenant_id, target_location_id, covered_table, 'needs_cleaning'
  from unnest(covered) as covered_table
  on conflict (tenant_id, location_id, table_id)
  do update set state = 'needs_cleaning', updated_at = now()
  where private.floor_table_service_states.state = 'occupied';

  insert into private.receipt_counters (tenant_id, location_id, last_number)
  values (target_tenant_id, target_location_id, 1)
  on conflict (tenant_id, location_id)
  do update set last_number = private.receipt_counters.last_number + 1
  returning last_number into next_number;

  receipt := private.build_account_receipt(
    target_tenant_id, target_location_id, target_session_id, next_number,
    account_session.opened_at, closing_time
  );
  insert into private.account_receipts (
    tenant_id, location_id, session_id, number, issued_by, issued_at, body
  ) values (
    target_tenant_id, target_location_id, target_session_id, next_number,
    target_staff_id, closing_time, receipt
  );

  perform private.append_audit_event(
    target_tenant_id, 'staff', target_staff_id, 'table_session.closed',
    'Cuenta cerrada con saldo cero y mesa pendiente de limpieza',
    'close:' || gen_random_uuid()::text, 'table_session', target_session_id
  );

  return private.finish_waiter_command(
    target_tenant_id, target_location_id, target_staff_id, target_command_id,
    jsonb_build_object(
      'sessionId', target_session_id,
      'closedAt', closing_time,
      'receipt', receipt,
      'tables', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'tableId', floor_table.id, 'label', floor_table.label,
          'state', private.waiter_table_state(
            target_tenant_id, target_location_id, floor_table.id)
        ) order by floor_table.position), '[]'::jsonb)
        from private.floor_tables floor_table
        where floor_table.tenant_id = target_tenant_id
          and floor_table.location_id = target_location_id
          and floor_table.id = any(covered)
      )
    )
  );
end;
$$;

-- 7. Cleaning --------------------------------------------------------------------------------

-- Marks a table clean: the manager, or a waiter who serves it. Removing the row is
-- what makes it available again.
create function private.mark_table_clean(
  target_tenant_id uuid,
  target_location_id uuid,
  target_staff_id uuid,
  target_command_id uuid,
  target_table_id uuid
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
  current_state text;
begin
  stored := private.claim_waiter_command(
    target_tenant_id, target_location_id, target_staff_id, target_command_id,
    jsonb_build_object('kind', 'mark_table_clean', 'tableId', target_table_id)
  );
  if stored is not null then
    return stored;
  end if;
  if not private.waiter_serves_table(
    target_tenant_id, target_location_id, target_staff_id, actor_role,
    target_table_id
  ) then
    raise exception 'table not found' using errcode = 'PT201';
  end if;

  select state.state into current_state
  from private.floor_table_service_states state
  where state.tenant_id = target_tenant_id
    and state.location_id = target_location_id
    and state.table_id = target_table_id
  for update;
  if current_state is distinct from 'needs_cleaning' then
    raise exception 'the table is not pending cleaning' using errcode = 'PT274';
  end if;

  delete from private.floor_table_service_states state
  where state.tenant_id = target_tenant_id
    and state.location_id = target_location_id
    and state.table_id = target_table_id;

  perform private.append_audit_event(
    target_tenant_id, 'staff', target_staff_id, 'table.cleaned',
    'Mesa marcada como limpia y habilitada', 'clean:' || gen_random_uuid()::text,
    'floor_table', target_table_id
  );
  return private.finish_waiter_command(
    target_tenant_id, target_location_id, target_staff_id, target_command_id,
    jsonb_build_object(
      'tableId', target_table_id,
      'state', private.waiter_table_state(
        target_tenant_id, target_location_id, target_table_id)
    )
  );
end;
$$;

-- 8. Reading the receipt and asking the cashier ----------------------------------------

create function private.account_receipt(
  target_tenant_id uuid,
  target_location_id uuid,
  target_staff_id uuid,
  target_session_id uuid
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
  stored jsonb;
begin
  if not private.waiter_serves_any_session(
    target_tenant_id, target_location_id, target_staff_id, actor_role,
    target_session_id
  ) then
    raise exception 'account not found' using errcode = 'PT201';
  end if;
  select receipt.body into stored
  from private.account_receipts receipt
  where receipt.tenant_id = target_tenant_id
    and receipt.location_id = target_location_id
    and receipt.session_id = target_session_id;
  if stored is null then
    raise exception 'the account has no receipt yet' using errcode = 'PT276';
  end if;
  return stored || jsonb_build_object('cashierRequest', (
    select jsonb_build_object('requestId', request.id, 'status', request.status)
    from private.cashier_requests request
    where request.tenant_id = target_tenant_id
      and request.location_id = target_location_id
      and request.session_id = target_session_id
    order by request.created_at desc, request.id desc
    limit 1
  ));
end;
$$;

-- "Avisar a caja": one open internal request per session, however many times it is
-- tapped. It stores no fiscal data.
create function private.request_cashier(
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
  request_id uuid;
  receipt_number integer;
begin
  stored := private.claim_waiter_command(
    target_tenant_id, target_location_id, target_staff_id, target_command_id,
    jsonb_build_object('kind', 'request_cashier', 'sessionId', target_session_id)
  );
  if stored is not null then
    return stored;
  end if;
  if not private.waiter_serves_any_session(
    target_tenant_id, target_location_id, target_staff_id, actor_role,
    target_session_id
  ) then
    raise exception 'account not found' using errcode = 'PT201';
  end if;
  select receipt.number into receipt_number
  from private.account_receipts receipt
  where receipt.tenant_id = target_tenant_id
    and receipt.location_id = target_location_id
    and receipt.session_id = target_session_id;
  if receipt_number is null then
    raise exception 'the account has no receipt yet' using errcode = 'PT276';
  end if;

  insert into private.cashier_requests (
    tenant_id, location_id, session_id, requested_by
  ) values (
    target_tenant_id, target_location_id, target_session_id, target_staff_id
  )
  on conflict (tenant_id, location_id, session_id) where status = 'open'
  do nothing
  returning id into request_id;
  if request_id is not null then
    perform private.append_audit_event(
      target_tenant_id, 'staff', target_staff_id, 'cashier.requested',
      'Aviso a caja por el comprobante de una cuenta cerrada',
      'cashier:' || gen_random_uuid()::text, 'table_session', target_session_id
    );
  else
    select request.id into request_id
    from private.cashier_requests request
    where request.tenant_id = target_tenant_id
      and request.location_id = target_location_id
      and request.session_id = target_session_id
      and request.status = 'open';
  end if;
  return private.finish_waiter_command(
    target_tenant_id, target_location_id, target_staff_id, target_command_id,
    jsonb_build_object(
      'requestId', request_id,
      'sessionId', target_session_id,
      'receiptNumber', receipt_number,
      'status', 'open'
    )
  );
end;
$$;

-- The manager marks the request as attended.
create function private.resolve_cashier_request(
  target_tenant_id uuid,
  target_location_id uuid,
  target_staff_id uuid,
  target_command_id uuid,
  target_request_id uuid
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
  request private.cashier_requests%rowtype;
begin
  stored := private.claim_waiter_command(
    target_tenant_id, target_location_id, target_staff_id, target_command_id,
    jsonb_build_object('kind', 'resolve_cashier_request', 'requestId', target_request_id)
  );
  if stored is not null then
    return stored;
  end if;
  if actor_role <> 'manager' then
    raise exception 'a manager is required' using errcode = 'PT222';
  end if;
  select * into request
  from private.cashier_requests candidate
  where candidate.tenant_id = target_tenant_id
    and candidate.location_id = target_location_id
    and candidate.id = target_request_id
  for update;
  if not found then
    raise exception 'request not found' using errcode = 'PT201';
  end if;
  if request.status = 'open' then
    update private.cashier_requests resolving
    set status = 'resolved', resolved_by = target_staff_id, resolved_at = now()
    where resolving.id = request.id;
    perform private.append_audit_event(
      target_tenant_id, 'staff', target_staff_id, 'cashier.request_resolved',
      'Solicitud a caja atendida', 'cashier:' || gen_random_uuid()::text,
      'table_session', request.session_id
    );
  end if;
  return private.finish_waiter_command(
    target_tenant_id, target_location_id, target_staff_id, target_command_id,
    jsonb_build_object('requestId', request.id, 'status', 'resolved')
  );
end;
$$;

-- Recently closed accounts in the actor's reach, with their receipt and request.
create function private.closed_accounts_view(
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
begin
  return jsonb_build_object('accounts', coalesce((
    select jsonb_agg(row_data.item order by row_data.closed_at desc, row_data.session_id)
    from (
      select
        account_session.closed_at,
        account_session.id as session_id,
        jsonb_build_object(
          'sessionId', account_session.id,
          'tableLabels', receipt.body -> 'tableLabels',
          'closedAt', account_session.closed_at,
          'receiptNumber', receipt.number,
          'totalCents', (receipt.body -> 'summary' ->> 'consumedCents')::integer,
          'cashierRequest', (
            select jsonb_build_object('requestId', request.id, 'status', request.status)
            from private.cashier_requests request
            where request.tenant_id = account_session.tenant_id
              and request.location_id = account_session.location_id
              and request.session_id = account_session.id
            order by request.created_at desc, request.id desc
            limit 1
          )
        ) as item
      from private.table_sessions account_session
      join private.account_receipts receipt
        on receipt.tenant_id = account_session.tenant_id
        and receipt.location_id = account_session.location_id
        and receipt.session_id = account_session.id
      where account_session.tenant_id = target_tenant_id
        and account_session.location_id = target_location_id
        and account_session.status = 'closed'
        and private.waiter_serves_any_session(
          target_tenant_id, target_location_id, target_staff_id, actor_role,
          account_session.id
        )
      order by account_session.closed_at desc, account_session.id
      limit 30
    ) row_data
  ), '[]'::jsonb));
end;
$$;

revoke all on function
  private.guard_table_service_state_change(),
  private.guard_cashier_request_change(),
  private.guard_closed_session_entry(),
  private.waiter_serves_any_session(uuid, uuid, uuid, text, uuid),
  private.session_table_ids(uuid, uuid, uuid),
  private.build_account_receipt(uuid, uuid, uuid, integer, timestamptz, timestamptz),
  private.close_table_session(uuid, uuid, uuid, uuid, uuid),
  private.mark_table_clean(uuid, uuid, uuid, uuid, uuid),
  private.account_receipt(uuid, uuid, uuid, uuid),
  private.request_cashier(uuid, uuid, uuid, uuid, uuid),
  private.resolve_cashier_request(uuid, uuid, uuid, uuid, uuid),
  private.closed_accounts_view(uuid, uuid, uuid)
from public, anon, authenticated, authenticator;
grant execute on function
  private.close_table_session(uuid, uuid, uuid, uuid, uuid),
  private.mark_table_clean(uuid, uuid, uuid, uuid, uuid),
  private.account_receipt(uuid, uuid, uuid, uuid),
  private.request_cashier(uuid, uuid, uuid, uuid, uuid),
  private.resolve_cashier_request(uuid, uuid, uuid, uuid, uuid),
  private.closed_accounts_view(uuid, uuid, uuid)
to authenticator;

commit;
