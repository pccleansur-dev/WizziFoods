begin;

-- Mercado Pago (T24): one OAuth connection per business, online payments that
-- confirm an order only when the provider reports them accredited, webhook
-- events that are recorded once, and refunds that follow the provider.
--
-- Rules this migration enforces in SQL, whatever the caller does:
--   * the provider's state is the only thing that confirms: `reconcile_online_payment`
--     receives a snapshot the API fetched from Mercado Pago with the tenant's own
--     credential, never a status taken from a webhook body;
--   * only an approved snapshot confirms the order and writes the payment
--     movement; pending, rejected and cancelled snapshots change nothing else;
--   * an older snapshot never overrides a newer one and a repeated one changes nothing;
--   * a payment whose order cannot be fulfilled is flagged `needs_refund` instead
--     of being lost.
-- Credentials are sealed by the API (T14): nothing here returns a token to a caller
-- other than the server-side payment flow.

-- 1. Orders confirmed by the system ----------------------------------------------------------

-- An accredited online payment confirms the order with no staff member involved.
alter table private.confirmed_orders alter column confirmed_by drop not null;
alter table private.confirmed_orders
  add constraint confirmed_orders_actor_check
    check (confirmed_by is not null or source = 'intent');
alter table private.table_sessions alter column opened_by drop not null;

create or replace function private.charge_confirmed_item()
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
    new.line_id,
    case when order_row.confirmed_by is null then 'system' else 'staff' end,
    order_row.confirmed_by, order_row.command_id
  );
  return new;
end;
$$;

-- An online intent waits for its payment and is confirmed only by it.
alter table private.order_intents drop constraint order_intents_status_path_check;
alter table private.order_intents
  add constraint order_intents_status_path_check check (
    (payment_path = 'online' and status in ('payment_pending', 'confirmed'))
    or (payment_path = 'in_person' and status in ('awaiting_waiter', 'confirmed', 'rejected'))
  );

create or replace function private.guard_order_intent_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status not in ('awaiting_waiter', 'payment_pending')
    or new.status not in ('confirmed', 'rejected')
    or (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status')
    -- An online intent is confirmed only by an accredited payment of its own,
    -- never rejected, and never by anyone writing the table.
    or (old.payment_path = 'online' and (
      new.status <> 'confirmed'
      or not exists (
        select 1 from private.online_payments payment
        where payment.tenant_id = old.tenant_id
          and payment.location_id = old.location_id
          and payment.intent_id = old.id
          and payment.status = 'approved'
          and payment.fulfillment = 'waiting'
      )))
  then
    raise exception 'an order intent may only be decided once' using errcode = 'PT209';
  end if;
  return new;
end;
$$;

-- The system acts too: payments are reconciled without a person.
alter table private.audit_events drop constraint audit_events_actor_type_check;
alter table private.audit_events
  add constraint audit_events_actor_type_check check (
    actor_type in ('platform_superadmin', 'tenant_admin', 'staff', 'support', 'system')
  );

-- 2. The ledger accepts the online method ------------------------------------------------------

alter table private.account_entries drop constraint account_entries_payment_method_check;
alter table private.account_entries
  add constraint account_entries_payment_method_check
    check (payment_method in (
      'cash', 'credit_card', 'debit_card', 'other_in_person', 'mercado_pago'
    )),
  -- Online money never goes through the drawer.
  add constraint account_entries_online_not_in_shift
    check (payment_method is distinct from 'mercado_pago' or shift_id is null);

-- An order confirmed with no staff member is audited as the system's own act.
do $patch$
declare
  definition text := pg_get_functiondef(
    'private.append_confirmed_order(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb)'::regprocedure
  );
  actor_anchor text := E'    target_tenant_id, ''staff'', target_staff_id,\n    case when target_intent_id is null then ''order.manual_confirmed''';
  reason_anchor text := E'         else ''Pedido del comensal confirmado por el personal'' end,';
  patched text;
begin
  if position(actor_anchor in definition) = 0
    or position(reason_anchor in definition) = 0
  then
    raise exception 'append_confirmed_order changed: patch anchor not found';
  end if;
  patched := replace(
    definition, actor_anchor,
    E'    target_tenant_id,\n'
      || E'    case when target_staff_id is null then ''system'' else ''staff'' end,\n'
      || E'    coalesce(target_staff_id, ''00000000-0000-4000-8000-000000000000''::uuid),\n'
      || E'    case when target_intent_id is null then ''order.manual_confirmed'''
  );
  patched := replace(
    patched, reason_anchor,
    E'         when target_staff_id is null then ''Pedido del comensal confirmado por un pago acreditado''\n'
      || reason_anchor
  );
  execute patched;
end;
$patch$;

-- An in-person refund cannot return an online payment: Mercado Pago does that.
do $patch$
declare
  definition text := pg_get_functiondef(
    'private.record_account_refund(uuid,uuid,uuid,uuid,uuid,uuid,integer,uuid,text)'::regprocedure
  );
  anchor text := E'    raise exception ''payment not found'' using errcode = ''PT201'';\n  end if;\n';
  patched text;
begin
  if position(anchor in definition) = 0 then
    raise exception 'record_account_refund changed: patch anchor not found';
  end if;
  patched := replace(
    definition, anchor,
    anchor || E'  if payment_entry.payment_method = ''mercado_pago'' then\n'
      || E'    raise exception ''online payments are refunded through Mercado Pago'' using errcode = ''PT243'';\n'
      || E'  end if;\n'
  );
  execute patched;
end;
$patch$;

-- 3. Connections (OAuth per business) -----------------------------------------------------------

-- The seller's Mercado Pago user id is what ties a notification to a business, so
-- one Mercado Pago account can be connected to one location only.
create table private.mp_connections (
  tenant_id uuid not null,
  location_id uuid not null,
  mp_user_id text not null check (mp_user_id ~ '^[0-9]{1,20}$'),
  live_mode boolean not null,
  connected_by uuid not null,
  connected_at timestamptz not null default now(),
  primary key (tenant_id, location_id),
  unique (mp_user_id),
  foreign key (tenant_id, location_id)
    references public.locations(tenant_id, id) on delete cascade
);

-- The state of the authorization redirect: stored hashed, valid once, short lived.
create table private.mp_oauth_states (
  state_hash bytea primary key check (octet_length(state_hash) = 32),
  tenant_id uuid not null,
  location_id uuid not null,
  requested_by uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  check (expires_at > created_at),
  foreign key (tenant_id, location_id)
    references public.locations(tenant_id, id) on delete cascade
);

-- 4. Online payments -----------------------------------------------------------------------------

create table private.online_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  location_id uuid not null,
  intent_id uuid not null,
  amount_cents integer not null check (amount_cents between 1 and 1000000000),
  status text not null default 'created'
    check (status in ('created', 'pending', 'approved', 'rejected', 'cancelled')),
  provider_payment_id text check (provider_payment_id ~ '^[0-9A-Za-z_-]{1,64}$'),
  provider_status text check (length(provider_status) between 1 and 40),
  provider_status_detail text check (length(provider_status_detail) between 1 and 100),
  provider_updated_at timestamptz,
  refunded_cents integer not null default 0 check (refunded_cents >= 0),
  fulfillment text not null default 'waiting'
    check (fulfillment in ('waiting', 'confirmed', 'needs_refund', 'closed')),
  order_id uuid,
  session_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, location_id, intent_id)
    references private.order_intents(tenant_id, location_id, id) on delete restrict,
  foreign key (tenant_id, location_id, order_id)
    references private.confirmed_orders(tenant_id, location_id, id) on delete restrict,
  check (refunded_cents <= amount_cents),
  check (refunded_cents = 0 or status = 'approved'),
  check (status = 'created' or provider_payment_id is not null),
  check ((fulfillment = 'confirmed') = (order_id is not null)),
  check (fulfillment = 'waiting' or status = 'approved')
);

-- One live attempt per intent; a rejected or cancelled one can be retried.
create unique index online_payments_active_attempt_idx
  on private.online_payments (tenant_id, location_id, intent_id)
  where status in ('created', 'pending', 'approved');
create unique index online_payments_provider_idx
  on private.online_payments (tenant_id, provider_payment_id)
  where provider_payment_id is not null;
create index online_payments_refund_idx
  on private.online_payments (tenant_id, location_id)
  where fulfillment = 'needs_refund';

create function private.guard_online_payment_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - array['status', 'provider_payment_id', 'provider_status',
        'provider_status_detail', 'provider_updated_at', 'refunded_cents',
        'fulfillment', 'order_id', 'session_id', 'updated_at'])
     is distinct from
     (to_jsonb(old) - array['status', 'provider_payment_id', 'provider_status',
        'provider_status_detail', 'provider_updated_at', 'refunded_cents',
        'fulfillment', 'order_id', 'session_id', 'updated_at'])
    or (old.provider_payment_id is not null
      and new.provider_payment_id is distinct from old.provider_payment_id)
    or new.refunded_cents < old.refunded_cents
    or (old.status in ('rejected', 'cancelled') and new.status <> old.status)
    or (old.status = 'approved' and new.status <> 'approved')
    or (old.status = 'pending' and new.status = 'created')
    or (old.fulfillment <> 'waiting' and new.fulfillment = 'waiting')
    or (old.fulfillment = 'confirmed' and new.fulfillment <> 'confirmed')
  then
    raise exception 'an online payment cannot change that way' using errcode = 'PT209';
  end if;
  return new;
end;
$$;

create trigger online_payments_guard_change
before update on private.online_payments
for each row execute function private.guard_online_payment_change();
create trigger online_payments_no_delete
before delete on private.online_payments
for each row execute function private.reject_append_only_change();
create trigger online_payments_no_truncate
before truncate on private.online_payments
for each statement execute function private.reject_append_only_change();

-- Each notification is recorded once; a repeat of a processed one does nothing.
create table private.mp_webhook_events (
  id bigint generated always as identity primary key,
  event_key text not null unique check (length(event_key) between 1 and 200),
  tenant_id uuid,
  location_id uuid,
  topic text not null check (length(topic) between 1 and 60),
  data_id text not null check (length(data_id) between 1 and 64),
  attempts integer not null default 1,
  outcome text check (outcome in (
    'applied', 'unchanged', 'stale', 'amount_mismatch', 'needs_refund',
    'ignored', 'unknown_seller', 'failed'
  )),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  check ((outcome is null) = (processed_at is null)),
  foreign key (tenant_id, location_id)
    references public.locations(tenant_id, id) on delete cascade
);

revoke all on table
  private.mp_connections, private.mp_oauth_states, private.online_payments,
  private.mp_webhook_events
from public, anon, authenticated, authenticator;
revoke all on sequence private.mp_webhook_events_id_seq
from public, anon, authenticated, authenticator;

-- 5. OAuth ------------------------------------------------------------------------------------------

-- Remembers who started the authorization; the callback consumes it exactly once.
create function private.begin_mp_oauth(
  target_tenant_id uuid,
  target_location_id uuid,
  target_requester_id uuid,
  target_state_hash bytea,
  target_ttl_seconds integer
)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
declare
  expiry timestamptz;
begin
  perform private.require_floor_plan_admin(
    target_tenant_id, target_location_id, target_requester_id
  );
  if target_ttl_seconds is null or target_ttl_seconds not between 60 and 3600 then
    raise exception 'invalid oauth ttl' using errcode = 'PT212';
  end if;
  delete from private.mp_oauth_states state
  where state.tenant_id = target_tenant_id
    and state.location_id = target_location_id
    and (state.used_at is not null or state.expires_at < now());
  expiry := now() + make_interval(secs => target_ttl_seconds);
  insert into private.mp_oauth_states (
    state_hash, tenant_id, location_id, requested_by, expires_at
  ) values (
    target_state_hash, target_tenant_id, target_location_id,
    target_requester_id, expiry
  );
  perform private.append_audit_event(
    target_tenant_id, 'tenant_admin', target_requester_id,
    'payment_provider.oauth_started', 'Conexión con Mercado Pago iniciada',
    gen_random_uuid()::text, 'location', target_location_id
  );
  return expiry;
end;
$$;

create function private.consume_mp_oauth_state(target_state_hash bytea)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
declare
  state private.mp_oauth_states%rowtype;
begin
  update private.mp_oauth_states candidate
  set used_at = now()
  where candidate.state_hash = target_state_hash
    and candidate.used_at is null
    and candidate.expires_at > now()
  returning * into state;
  if not found then
    raise exception 'invalid or expired oauth state' using errcode = 'PT250';
  end if;
  return jsonb_build_object(
    'tenantId', state.tenant_id,
    'locationId', state.location_id,
    'requesterId', state.requested_by
  );
end;
$$;

-- Stores what the authorization returned: the sealed tokens, the public key and
-- the seller id. The method stays as the administrator left it (enabled or not).
create function private.finish_mp_connection(
  target_tenant_id uuid,
  target_location_id uuid,
  target_requester_id uuid,
  target_mp_user_id text,
  target_live_mode boolean,
  target_public_key text,
  target_ciphertext bytea,
  target_key_version smallint
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
declare
  current_enabled boolean;
begin
  perform private.lock_payment_methods(
    target_tenant_id, target_location_id, target_requester_id
  );
  if target_mp_user_id is null or target_mp_user_id !~ '^[0-9]{1,20}$' then
    raise exception 'invalid seller' using errcode = 'PT212';
  end if;
  if exists (
    select 1 from private.mp_connections connection
    where connection.mp_user_id = target_mp_user_id
      and (connection.tenant_id, connection.location_id)
        is distinct from (target_tenant_id, target_location_id)
  ) then
    raise exception 'that Mercado Pago account is connected elsewhere' using errcode = 'PT251';
  end if;

  select method.enabled into current_enabled
  from private.payment_methods method
  where method.tenant_id = target_tenant_id
    and method.location_id = target_location_id
    and method.method_key = 'mercado_pago';

  perform private.store_payment_secret(
    target_tenant_id, target_location_id, target_requester_id,
    'mercado_pago', target_ciphertext, target_key_version
  );
  perform private.update_payment_method(
    target_tenant_id, target_location_id, target_requester_id,
    'mercado_pago', current_enabled,
    jsonb_build_object('publicKey', target_public_key)
  );
  insert into private.mp_connections (
    tenant_id, location_id, mp_user_id, live_mode, connected_by
  ) values (
    target_tenant_id, target_location_id, target_mp_user_id,
    target_live_mode, target_requester_id
  )
  on conflict (tenant_id, location_id) do update
  set mp_user_id = excluded.mp_user_id,
      live_mode = excluded.live_mode,
      connected_by = excluded.connected_by,
      connected_at = now();
  perform private.append_audit_event(
    target_tenant_id, 'tenant_admin', target_requester_id,
    'payment_provider.connected', 'Mercado Pago conectado',
    gen_random_uuid()::text, 'location', target_location_id
  );
  return private.payment_methods_view(target_tenant_id, target_location_id);
end;
$$;

create function private.disconnect_mp(
  target_tenant_id uuid,
  target_location_id uuid,
  target_requester_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
begin
  perform private.require_floor_plan_admin(
    target_tenant_id, target_location_id, target_requester_id
  );
  delete from private.mp_connections connection
  where connection.tenant_id = target_tenant_id
    and connection.location_id = target_location_id;
  return private.clear_payment_secret(
    target_tenant_id, target_location_id, target_requester_id, 'mercado_pago'
  );
end;
$$;

-- Server-side payment flows read the sealed credential of one business.
create function private.read_mp_credentials(
  target_tenant_id uuid,
  target_location_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select jsonb_build_object(
    'ciphertext', encode(secret.ciphertext, 'base64'),
    'keyVersion', secret.key_version,
    'mpUserId', connection.mp_user_id,
    'liveMode', connection.live_mode,
    'publicKey', method.public_config ->> 'publicKey'
  )
  from private.payment_method_secrets secret
  join private.payment_methods method
    on method.tenant_id = secret.tenant_id
    and method.location_id = secret.location_id
    and method.method_key = secret.method_key
  join private.mp_connections connection
    on connection.tenant_id = secret.tenant_id
    and connection.location_id = secret.location_id
  where secret.tenant_id = target_tenant_id
    and secret.location_id = target_location_id
    and secret.method_key = 'mercado_pago';
$$;

-- A refreshed token replaces the stored one; nobody else changes credentials here.
create function private.replace_mp_credentials(
  target_tenant_id uuid,
  target_location_id uuid,
  target_ciphertext bytea,
  target_key_version smallint
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
begin
  update private.payment_method_secrets secret
  set ciphertext = target_ciphertext,
      key_version = target_key_version,
      updated_at = statement_timestamp()
  where secret.tenant_id = target_tenant_id
    and secret.location_id = target_location_id
    and secret.method_key = 'mercado_pago';
  if not found then
    raise exception 'no credential to replace' using errcode = 'PT201';
  end if;
end;
$$;

-- A notification names the seller, never the business: this maps one to the other.
create function private.resolve_mp_account(target_mp_user_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select jsonb_build_object(
    'tenantId', connection.tenant_id,
    'locationId', connection.location_id
  )
  from private.mp_connections connection
  where connection.mp_user_id = target_mp_user_id;
$$;

-- 6. Payment attempts ----------------------------------------------------------------------------

create function private.online_payment_json(payment private.online_payments)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'paymentId', payment.id,
    'intentId', payment.intent_id,
    'status', payment.status,
    'amountCents', payment.amount_cents,
    'refundedCents', payment.refunded_cents,
    'fulfillment', payment.fulfillment
  );
$$;

-- Starts (or returns) the live attempt of an online intent. The amount is the
-- intent's own total: nothing the caller sends can change what is charged.
create function private.begin_online_payment(
  target_tenant_id uuid,
  target_location_id uuid,
  target_intent_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
declare
  intent private.order_intents%rowtype;
  payment private.online_payments%rowtype;
begin
  select * into intent
  from private.order_intents candidate
  where candidate.tenant_id = target_tenant_id
    and candidate.location_id = target_location_id
    and candidate.id = target_intent_id
  for update;
  if not found then
    raise exception 'intent not found' using errcode = 'PT201';
  end if;
  if intent.payment_path <> 'online' or intent.status <> 'payment_pending' then
    raise exception 'intent is not awaiting an online payment' using errcode = 'PT252';
  end if;
  if intent.total_cents <= 0 then
    raise exception 'nothing to charge' using errcode = 'PT252';
  end if;

  select * into payment
  from private.online_payments attempt
  where attempt.tenant_id = target_tenant_id
    and attempt.location_id = target_location_id
    and attempt.intent_id = target_intent_id
    and attempt.status in ('created', 'pending', 'approved');
  if not found then
    insert into private.online_payments (
      tenant_id, location_id, intent_id, amount_cents
    ) values (
      target_tenant_id, target_location_id, target_intent_id, intent.total_cents
    )
    returning * into payment;
  end if;
  return private.online_payment_json(payment)
    || jsonb_build_object('externalReference', payment.id);
end;
$$;

-- The diner proves the intent is theirs with the QR token of its table.
create function private.diner_owns_intent(
  target_tenant_id uuid,
  target_location_id uuid,
  target_token text,
  target_intent_id uuid
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
    from private.order_intents intent
    join private.floor_table_qr_codes qr
      on qr.tenant_id = intent.tenant_id
      and qr.location_id = intent.location_id
      and qr.table_id = intent.table_id
    where intent.tenant_id = target_tenant_id
      and intent.location_id = target_location_id
      and intent.id = target_intent_id
      and qr.token = target_token
      and qr.status = 'active'
  );
$$;

create function private.begin_diner_online_payment(
  target_tenant_id uuid,
  target_location_id uuid,
  target_token text,
  target_intent_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
begin
  if not private.diner_owns_intent(
    target_tenant_id, target_location_id, target_token, target_intent_id
  ) then
    raise exception 'intent not found' using errcode = 'PT201';
  end if;
  return private.begin_online_payment(
    target_tenant_id, target_location_id, target_intent_id
  );
end;
$$;

create function private.diner_online_payment_view(
  target_tenant_id uuid,
  target_location_id uuid,
  target_token text,
  target_intent_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set row_security = off
as $$
begin
  if not private.diner_owns_intent(
    target_tenant_id, target_location_id, target_token, target_intent_id
  ) then
    raise exception 'intent not found' using errcode = 'PT201';
  end if;
  return private.online_payment_view(
    target_tenant_id, target_location_id, target_intent_id
  );
end;
$$;

-- What the diner may see while waiting: the intent and its latest attempt.
create function private.online_payment_view(
  target_tenant_id uuid,
  target_location_id uuid,
  target_intent_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set row_security = off
as $$
declare
  intent private.order_intents%rowtype;
  payment private.online_payments%rowtype;
begin
  select * into intent
  from private.order_intents candidate
  where candidate.tenant_id = target_tenant_id
    and candidate.location_id = target_location_id
    and candidate.id = target_intent_id;
  if not found or intent.payment_path <> 'online' then
    raise exception 'intent not found' using errcode = 'PT201';
  end if;
  select * into payment
  from private.online_payments attempt
  where attempt.tenant_id = target_tenant_id
    and attempt.location_id = target_location_id
    and attempt.intent_id = target_intent_id
  order by attempt.created_at desc, attempt.id
  limit 1;
  return jsonb_build_object(
    'intentId', intent.id,
    'intentStatus', intent.status,
    'totalCents', intent.total_cents,
    'payment', case when payment.id is null then null else
      jsonb_build_object(
        'paymentId', payment.id,
        'status', payment.status,
        'statusDetail', payment.provider_status_detail,
        'amountCents', payment.amount_cents,
        'refundedCents', payment.refunded_cents,
        'fulfillment', payment.fulfillment
      ) end
  );
end;
$$;

-- 7. Reconciliation ------------------------------------------------------------------------------

-- Applies an authoritative snapshot of a Mercado Pago payment. It is idempotent
-- and monotonic: repeating a snapshot changes nothing, an older one is ignored,
-- and an accredited payment is never downgraded.
create function private.reconcile_online_payment(
  target_tenant_id uuid,
  target_location_id uuid,
  target_payment_id uuid,
  target_external_reference text,
  target_provider_payment_id text,
  target_provider_status text,
  target_status_detail text,
  target_amount_cents integer,
  target_refunded_cents integer,
  target_provider_updated_at timestamptz
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
declare
  payment private.online_payments%rowtype;
  intent private.order_intents%rowtype;
  mapped text;
  next_fulfillment text;
  refunded integer;
  quote jsonb;
  placed jsonb;
  placed_order uuid;
  placed_session uuid;
  delta integer;
  outcome text := 'applied';
begin
  select * into payment
  from private.online_payments attempt
  where attempt.tenant_id = target_tenant_id
    and attempt.location_id = target_location_id
    and attempt.id = target_payment_id
  for update;
  if not found then
    raise exception 'payment not found' using errcode = 'PT201';
  end if;
  -- The provider's record must be the one this business created for this attempt.
  if target_external_reference is distinct from payment.id::text
    or (payment.provider_payment_id is not null
      and payment.provider_payment_id <> target_provider_payment_id)
    or target_provider_payment_id !~ '^[0-9A-Za-z_-]{1,64}$'
  then
    raise exception 'payment does not match' using errcode = 'PT253';
  end if;
  if target_amount_cents is distinct from payment.amount_cents then
    perform private.append_audit_event(
      target_tenant_id, 'system', '00000000-0000-4000-8000-000000000000',
      'online_payment.amount_mismatch',
      'El monto informado por Mercado Pago no coincide con el pedido',
      'mp:' || payment.id::text, 'online_payment', payment.id
    );
    return private.online_payment_json(payment)
      || jsonb_build_object('outcome', 'amount_mismatch', 'orderId', payment.order_id);
  end if;

  mapped := case target_provider_status
    when 'approved' then 'approved'
    when 'refunded' then 'approved'
    when 'charged_back' then 'approved'
    when 'pending' then 'pending'
    when 'in_process' then 'pending'
    when 'in_mediation' then 'pending'
    when 'authorized' then 'pending'
    when 'rejected' then 'rejected'
    when 'cancelled' then 'cancelled'
    else null
  end;
  if mapped is null then
    return private.online_payment_json(payment)
      || jsonb_build_object('outcome', 'ignored', 'orderId', payment.order_id);
  end if;
  refunded := greatest(coalesce(target_refunded_cents, 0), 0);
  if target_provider_status = 'refunded' then
    refunded := payment.amount_cents;
  end if;
  if refunded > payment.amount_cents then
    raise exception 'refund exceeds the payment' using errcode = 'PT253';
  end if;

  -- Reordering: a snapshot older than the one already applied, or one that would
  -- downgrade the attempt, changes nothing.
  if (payment.provider_updated_at is not null
      and target_provider_updated_at < payment.provider_updated_at)
    or (payment.status = 'approved' and mapped <> 'approved')
    or (payment.status in ('rejected', 'cancelled') and mapped <> payment.status)
    or (payment.status = 'pending' and mapped = 'created')
  then
    return private.online_payment_json(payment)
      || jsonb_build_object('outcome', 'stale', 'orderId', payment.order_id);
  end if;
  if payment.status = mapped
    and payment.provider_status is not distinct from target_provider_status
    and payment.provider_payment_id is not distinct from target_provider_payment_id
    and refunded <= payment.refunded_cents
    and (mapped <> 'approved' or payment.fulfillment <> 'waiting')
  then
    return private.online_payment_json(payment)
      || jsonb_build_object('outcome', 'unchanged', 'orderId', payment.order_id);
  end if;

  next_fulfillment := payment.fulfillment;
  placed_order := payment.order_id;
  placed_session := payment.session_id;

  if mapped = 'approved' and payment.fulfillment = 'waiting' then
    -- Only an accredited payment confirms. The attempt is recorded as approved
    -- first (the intent's guard looks for it); if the order can no longer be
    -- served, the money is flagged for return instead of being forgotten.
    update private.online_payments attempt
    set status = 'approved',
        provider_payment_id = target_provider_payment_id,
        provider_status = target_provider_status,
        provider_updated_at = greatest(
          coalesce(attempt.provider_updated_at, target_provider_updated_at),
          target_provider_updated_at
        ),
        updated_at = statement_timestamp()
    where attempt.id = payment.id;
    begin
      select * into intent
      from private.order_intents candidate
      where candidate.tenant_id = target_tenant_id
        and candidate.location_id = target_location_id
        and candidate.id = payment.intent_id
      for update;
      if intent.status <> 'payment_pending' or intent.total_cents <> payment.amount_cents then
        raise exception 'intent changed' using errcode = 'PT211';
      end if;
      perform private.assert_table_accepts_orders(
        target_tenant_id, target_location_id, intent.table_id
      );
      quote := private.quote_and_reserve_lines(
        target_tenant_id, target_location_id,
        (select jsonb_agg(jsonb_build_object(
          'lineId', item.line_id,
          'productId', item.product_id,
          'variantId', coalesce(to_jsonb(item.variant_id::text), 'null'::jsonb),
          'quantity', item.quantity,
          'unitPriceCents', item.unit_price_cents
        ) order by item.created_at, item.title, item.line_id)
        from private.order_intent_items item
        where item.tenant_id = target_tenant_id
          and item.location_id = target_location_id
          and item.intent_id = intent.id),
        true
      );
      if (quote ->> 'totalCents')::integer <> payment.amount_cents then
        raise exception 'total changed' using errcode = 'PT211';
      end if;
      placed := private.append_confirmed_order(
        target_tenant_id, target_location_id, null, gen_random_uuid(),
        intent.table_id, intent.id, intent.attribution, intent.diner_name,
        intent.seat_label, quote
      );
      placed_order := (placed ->> 'orderId')::uuid;
      select confirmed.session_id into placed_session
      from private.confirmed_orders confirmed
      where confirmed.tenant_id = target_tenant_id
        and confirmed.location_id = target_location_id
        and confirmed.id = placed_order;
      insert into private.account_entries (
        tenant_id, location_id, session_id, kind, amount_cents, origin, cause,
        source_type, source_id, actor_type, actor_id, payment_method
      ) values (
        target_tenant_id, target_location_id, placed_session, 'payment',
        -payment.amount_cents, 'payment',
        'Pago online acreditado en Mercado Pago', 'payment', payment.id,
        'system', null, 'mercado_pago'
      );
      update private.order_intents candidate
      set status = 'confirmed'
      where candidate.tenant_id = target_tenant_id
        and candidate.location_id = target_location_id
        and candidate.id = intent.id;
      next_fulfillment := 'confirmed';
    exception
      when sqlstate 'PT102' or sqlstate 'PT104' or sqlstate 'PT105'
        or sqlstate 'PT206' or sqlstate 'PT210' or sqlstate 'PT211' then
        next_fulfillment := 'needs_refund';
        placed_order := null;
        placed_session := null;
    end;
    perform private.append_audit_event(
      target_tenant_id, 'system', '00000000-0000-4000-8000-000000000000',
      case when next_fulfillment = 'confirmed' then 'online_payment.confirmed'
           else 'online_payment.needs_refund' end,
      case when next_fulfillment = 'confirmed'
           then 'Pedido confirmado por un pago acreditado'
           else 'Pago acreditado que no pudo confirmar el pedido: requiere devolución' end,
      'mp:' || payment.id::text, 'online_payment', payment.id
    );
    if next_fulfillment = 'needs_refund' then
      outcome := 'needs_refund';
    end if;
  end if;

  -- Money given back by Mercado Pago: only the increase is recorded, once.
  if mapped = 'approved' and refunded > payment.refunded_cents then
    delta := refunded - payment.refunded_cents;
    if next_fulfillment = 'confirmed' then
      insert into private.account_entries (
        tenant_id, location_id, session_id, kind, amount_cents, origin, cause,
        source_type, source_id, actor_type, actor_id, payment_method,
        refund_of_source_id
      ) values (
        target_tenant_id, target_location_id, placed_session, 'refund', delta,
        'refund', 'Devolución en Mercado Pago', 'refund', gen_random_uuid(),
        'system', null, 'mercado_pago', payment.id
      );
      perform private.append_audit_event(
        target_tenant_id, 'system', '00000000-0000-4000-8000-000000000000',
        'online_payment.refunded', 'Devolución de un pago online registrada',
        'mp:' || payment.id::text, 'online_payment', payment.id
      );
    elsif next_fulfillment = 'needs_refund' and refunded = payment.amount_cents then
      next_fulfillment := 'closed';
    end if;
  elsif mapped = 'approved' then
    refunded := payment.refunded_cents;
  else
    refunded := payment.refunded_cents;
  end if;

  update private.online_payments attempt
  set status = mapped,
      provider_payment_id = target_provider_payment_id,
      provider_status = target_provider_status,
      provider_status_detail = nullif(left(coalesce(target_status_detail, ''), 100), ''),
      provider_updated_at = greatest(
        coalesce(attempt.provider_updated_at, target_provider_updated_at),
        target_provider_updated_at
      ),
      refunded_cents = refunded,
      fulfillment = next_fulfillment,
      order_id = placed_order,
      session_id = placed_session,
      updated_at = statement_timestamp()
  where attempt.id = payment.id
  returning * into payment;

  return private.online_payment_json(payment)
    || jsonb_build_object('outcome', outcome, 'orderId', payment.order_id);
end;
$$;

-- A manager's refund of an online payment: checked here, executed by the API against
-- Mercado Pago, and recorded only when Mercado Pago reports it.
create function private.prepare_online_refund(
  target_tenant_id uuid,
  target_location_id uuid,
  target_staff_id uuid,
  target_session_id uuid,
  target_payment_id uuid,
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
  payment private.online_payments%rowtype;
  credit integer;
  clean_reason text;
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
  clean_reason := private.required_reason(target_reason);
  if target_amount_cents is null or target_amount_cents <= 0 then
    raise exception 'invalid refund' using errcode = 'PT212';
  end if;
  select * into payment
  from private.online_payments attempt
  where attempt.tenant_id = target_tenant_id
    and attempt.location_id = target_location_id
    and attempt.id = target_payment_id
    and attempt.session_id = target_session_id
    and attempt.status = 'approved'
    and attempt.fulfillment = 'confirmed'
  for update;
  if not found then
    raise exception 'payment not found' using errcode = 'PT201';
  end if;
  credit := -(private.account_summary(
    target_tenant_id, target_location_id, target_session_id
  ) ->> 'pendingCents')::integer;
  if target_amount_cents > greatest(credit, 0)
    or target_amount_cents > payment.amount_cents - payment.refunded_cents
  then
    raise exception 'the refund exceeds the limit' using errcode = 'PT242';
  end if;
  perform private.append_audit_event(
    target_tenant_id, 'staff', target_staff_id, 'online_payment.refund_requested',
    'Devolución de un pago online solicitada: ' || clean_reason, 'mp:' || payment.id::text,
    'online_payment', payment.id
  );
  return jsonb_build_object(
    'paymentId', payment.id,
    'providerPaymentId', payment.provider_payment_id,
    'amountCents', target_amount_cents
  );
end;
$$;

-- Accredited payments whose order could not be served and that still hold money.
create function private.online_payments_needing_refund(target_limit integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'tenantId', payment.tenant_id,
    'locationId', payment.location_id,
    'paymentId', payment.id,
    'providerPaymentId', payment.provider_payment_id,
    'remainingCents', payment.amount_cents - payment.refunded_cents
  ) order by payment.updated_at), '[]'::jsonb)
  from (
    select * from private.online_payments candidate
    where candidate.fulfillment = 'needs_refund'
    order by candidate.updated_at
    limit least(greatest(coalesce(target_limit, 20), 1), 100)
  ) payment;
$$;

-- 8. Webhook events ---------------------------------------------------------------------------------

create function private.claim_mp_webhook_event(
  target_event_key text,
  target_tenant_id uuid,
  target_location_id uuid,
  target_topic text,
  target_data_id text
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
declare
  inserted bigint;
  processed timestamptz;
begin
  insert into private.mp_webhook_events (
    event_key, tenant_id, location_id, topic, data_id
  ) values (
    target_event_key, target_tenant_id, target_location_id, target_topic, target_data_id
  )
  on conflict (event_key) do nothing
  returning id into inserted;
  if inserted is not null then
    return 'new';
  end if;
  select event.processed_at into processed
  from private.mp_webhook_events event
  where event.event_key = target_event_key
  for update;
  if processed is not null then
    return 'duplicate';
  end if;
  update private.mp_webhook_events event
  set attempts = event.attempts + 1
  where event.event_key = target_event_key;
  return 'retry';
end;
$$;

create function private.finish_mp_webhook_event(
  target_event_key text,
  target_outcome text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
begin
  update private.mp_webhook_events event
  set outcome = target_outcome,
      processed_at = now()
  where event.event_key = target_event_key
    and event.processed_at is null;
end;
$$;

-- Grants: the API reaches these entry points and nothing else.
revoke all on function
  private.begin_mp_oauth(uuid, uuid, uuid, bytea, integer),
  private.consume_mp_oauth_state(bytea),
  private.finish_mp_connection(uuid, uuid, uuid, text, boolean, text, bytea, smallint),
  private.disconnect_mp(uuid, uuid, uuid),
  private.read_mp_credentials(uuid, uuid),
  private.replace_mp_credentials(uuid, uuid, bytea, smallint),
  private.resolve_mp_account(text),
  private.online_payment_json(private.online_payments),
  private.begin_online_payment(uuid, uuid, uuid),
  private.online_payment_view(uuid, uuid, uuid),
  private.diner_owns_intent(uuid, uuid, text, uuid),
  private.begin_diner_online_payment(uuid, uuid, text, uuid),
  private.diner_online_payment_view(uuid, uuid, text, uuid),
  private.reconcile_online_payment(uuid, uuid, uuid, text, text, text, text, integer, integer, timestamptz),
  private.prepare_online_refund(uuid, uuid, uuid, uuid, uuid, integer, text),
  private.online_payments_needing_refund(integer),
  private.claim_mp_webhook_event(text, uuid, uuid, text, text),
  private.finish_mp_webhook_event(text, text)
from public, anon, authenticated, authenticator;
grant execute on function
  private.begin_mp_oauth(uuid, uuid, uuid, bytea, integer),
  private.consume_mp_oauth_state(bytea),
  private.finish_mp_connection(uuid, uuid, uuid, text, boolean, text, bytea, smallint),
  private.disconnect_mp(uuid, uuid, uuid),
  private.read_mp_credentials(uuid, uuid),
  private.replace_mp_credentials(uuid, uuid, bytea, smallint),
  private.resolve_mp_account(text),
  private.begin_online_payment(uuid, uuid, uuid),
  private.online_payment_view(uuid, uuid, uuid),
  private.begin_diner_online_payment(uuid, uuid, text, uuid),
  private.diner_online_payment_view(uuid, uuid, text, uuid),
  private.reconcile_online_payment(uuid, uuid, uuid, text, text, text, text, integer, integer, timestamptz),
  private.prepare_online_refund(uuid, uuid, uuid, uuid, uuid, integer, text),
  private.online_payments_needing_refund(integer),
  private.claim_mp_webhook_event(text, uuid, uuid, text, text),
  private.finish_mp_webhook_event(text, text)
to authenticator;

commit;
