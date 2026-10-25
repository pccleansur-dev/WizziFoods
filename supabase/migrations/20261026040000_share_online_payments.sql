begin;

-- Paying a reserved share with Mercado Pago (T25, part 3).
--
-- An online payment can now belong to a share of a split instead of an order intent.
-- The rules of T24 stay: the provider's authoritative snapshot is the only thing that
-- moves money. An approved snapshot pays the share (and writes the account's payment
-- movement) only if the share is still reserved, still the same amount and the balance
-- still covers it; otherwise the money is flagged for return instead of being lost.

alter table private.online_payments
  alter column intent_id drop not null,
  add column share_split_id uuid,
  add column share_position integer,
  drop constraint online_payments_check3,
  add constraint online_payments_target_check
    check ((intent_id is null) <> (share_split_id is null)),
  add constraint online_payments_share_check
    check ((share_split_id is null) = (share_position is null)),
  add constraint online_payments_fulfillment_order_check
    check (
      (share_split_id is null and (fulfillment = 'confirmed') = (order_id is not null))
      or (share_split_id is not null and order_id is null)
    ),
  add constraint online_payments_share_fkey
    foreign key (share_split_id, share_position)
    references private.account_split_shares(split_id, position) on delete restrict;

create unique index online_payments_active_share_idx
  on private.online_payments (tenant_id, location_id, share_split_id, share_position)
  where share_split_id is not null and status in ('created', 'pending', 'approved');

-- Marks the share as paid by this online payment and writes the account movement.
create function private.claim_share_for_payment(target_payment_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
declare
  payment private.online_payments%rowtype;
  target_session uuid;
  share private.account_split_shares%rowtype;
  pending integer;
begin
  select * into payment from private.online_payments attempt
  where attempt.id = target_payment_id;
  select split.session_id into target_session
  from private.account_splits split where split.id = payment.share_split_id;
  perform 1 from private.table_sessions account_session
  where account_session.tenant_id = payment.tenant_id
    and account_session.location_id = payment.location_id
    and account_session.id = target_session
    and account_session.status = 'open'
  for update;
  if not found then
    raise exception 'the account is closed' using errcode = 'PT260';
  end if;
  select * into share from private.account_split_shares candidate
  where candidate.split_id = payment.share_split_id
    and candidate.position = payment.share_position
  for update;
  if share.status <> 'claimed' or share.amount_cents <> payment.amount_cents then
    raise exception 'the share is no longer available' using errcode = 'PT260';
  end if;
  pending := (private.account_summary(
    payment.tenant_id, payment.location_id, target_session) ->> 'pendingCents')::integer;
  if pending <= 0 then
    raise exception 'nothing to collect' using errcode = 'PT231';
  end if;
  if payment.amount_cents > pending then
    raise exception 'the payment exceeds the pending balance' using errcode = 'PT230';
  end if;

  insert into private.account_entries (
    tenant_id, location_id, session_id, kind, amount_cents, origin, cause,
    source_type, source_id, actor_type, actor_id, payment_method
  ) values (
    payment.tenant_id, payment.location_id, target_session, 'payment',
    -payment.amount_cents, 'payment',
    'Pago online de una parte de la cuenta en Mercado Pago', 'payment',
    payment.id, 'system', null, 'mercado_pago');
  update private.account_split_shares candidate
  set status = 'paid', payment_id = payment.id, paid_at = now()
  where candidate.split_id = payment.share_split_id
    and candidate.position = payment.share_position;
  update private.account_splits split
  set status = 'done'
  where split.id = payment.share_split_id
    and not exists (
      select 1 from private.account_split_shares open_share
      where open_share.split_id = split.id and open_share.status in ('open', 'claimed'));
  return target_session;
end;
$$;

-- The reconciler pays a share instead of confirming an order when the attempt is one.
do $patch$
declare
  definition text := pg_get_functiondef(
    'private.reconcile_online_payment(uuid,uuid,uuid,text,text,text,text,integer,integer,timestamptz)'::regprocedure
  );
  anchor text := E'  if mapped = ''approved'' and payment.fulfillment = ''waiting'' then\n';
begin
  if position(anchor in definition) = 0 then
    raise exception 'reconcile_online_payment changed: patch anchor not found';
  end if;
  execute replace(
    definition, anchor,
    E'  if mapped = ''approved'' and payment.fulfillment = ''waiting''\n'
      || E'    and payment.share_split_id is not null\n'
      || E'  then\n'
      || E'    update private.online_payments attempt\n'
      || E'    set status = ''approved'',\n'
      || E'        provider_payment_id = target_provider_payment_id,\n'
      || E'        provider_status = target_provider_status,\n'
      || E'        provider_updated_at = greatest(\n'
      || E'          coalesce(attempt.provider_updated_at, target_provider_updated_at),\n'
      || E'          target_provider_updated_at),\n'
      || E'        updated_at = statement_timestamp()\n'
      || E'    where attempt.id = payment.id;\n'
      || E'    begin\n'
      || E'      placed_session := private.claim_share_for_payment(payment.id);\n'
      || E'      next_fulfillment := ''confirmed'';\n'
      || E'    exception\n'
      || E'      when sqlstate ''PT260'' or sqlstate ''PT230'' or sqlstate ''PT231'' then\n'
      || E'        next_fulfillment := ''needs_refund'';\n'
      || E'        placed_session := null;\n'
      || E'    end;\n'
      || E'    perform private.append_audit_event(\n'
      || E'      target_tenant_id, ''system'', ''00000000-0000-4000-8000-000000000000'',\n'
      || E'      case when next_fulfillment = ''confirmed'' then ''online_payment.share_paid''\n'
      || E'           else ''online_payment.needs_refund'' end,\n'
      || E'      case when next_fulfillment = ''confirmed''\n'
      || E'           then ''Parte de la cuenta pagada con un pago acreditado''\n'
      || E'           else ''Pago acreditado de una parte que ya no estaba disponible: requiere devolución'' end,\n'
      || E'      ''mp:'' || payment.id::text, ''online_payment'', payment.id\n'
      || E'    );\n'
      || E'    if next_fulfillment = ''needs_refund'' then\n'
      || E'      outcome := ''needs_refund'';\n'
      || E'    end if;\n'
      || E'  elsif mapped = ''approved'' and payment.fulfillment = ''waiting'' then\n'
  );
end;
$patch$;

-- JSON of any attempt, with the intent or the share it belongs to.
create function private.share_payment_json(payment private.online_payments)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'paymentId', payment.id,
    'position', payment.share_position,
    'status', payment.status,
    'amountCents', payment.amount_cents,
    'refundedCents', payment.refunded_cents,
    'fulfillment', payment.fulfillment,
    'externalReference', payment.id
  );
$$;

-- Starts (or returns) the live attempt to pay a share this device reserved.
create function private.begin_share_online_payment(
  target_tenant_id uuid,
  target_location_id uuid,
  target_token text,
  target_position integer,
  target_secret_hash bytea
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
declare
  target_session uuid := private.diner_split_session(
    target_tenant_id, target_location_id, target_token);
  share private.account_split_shares%rowtype;
  target_split uuid;
  payment private.online_payments%rowtype;
begin
  if target_session is null then
    raise exception 'account not found' using errcode = 'PT201';
  end if;
  perform 1 from private.table_sessions account_session
  where account_session.tenant_id = target_tenant_id
    and account_session.location_id = target_location_id
    and account_session.id = target_session
  for update;
  select split.id into target_split from private.account_splits split
  where split.tenant_id = target_tenant_id
    and split.location_id = target_location_id
    and split.session_id = target_session
    and split.status = 'open';
  select * into share from private.account_split_shares candidate
  where candidate.split_id = target_split and candidate.position = target_position;
  if not found or share.status <> 'claimed'
    or share.claimed_hash is distinct from target_secret_hash
  then
    raise exception 'that share is not yours' using errcode = 'PT260';
  end if;
  select * into payment from private.online_payments attempt
  where attempt.tenant_id = target_tenant_id
    and attempt.location_id = target_location_id
    and attempt.share_split_id = target_split
    and attempt.share_position = target_position
    and attempt.status in ('created', 'pending', 'approved');
  if not found then
    insert into private.online_payments (
      tenant_id, location_id, share_split_id, share_position, amount_cents
    ) values (
      target_tenant_id, target_location_id, target_split, target_position,
      share.amount_cents)
    returning * into payment;
  end if;
  return private.share_payment_json(payment);
end;
$$;

-- The latest attempt of a share and where the share stands.
create function private.share_payment_view(
  target_tenant_id uuid,
  target_location_id uuid,
  target_token text,
  target_position integer,
  target_secret_hash bytea
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set row_security = off
as $$
declare
  target_session uuid := private.diner_split_session(
    target_tenant_id, target_location_id, target_token);
  payment private.online_payments%rowtype;
  share_status text;
begin
  if target_session is null then
    raise exception 'account not found' using errcode = 'PT201';
  end if;
  -- The last attempt on that position of the account's splits that this device owns.
  select attempt.* into payment
  from private.online_payments attempt
  join private.account_splits split on split.id = attempt.share_split_id
  join private.account_split_shares share
    on share.split_id = attempt.share_split_id and share.position = attempt.share_position
  where split.tenant_id = target_tenant_id
    and split.location_id = target_location_id
    and split.session_id = target_session
    and attempt.share_position = target_position
    and share.claimed_hash is not distinct from target_secret_hash
  order by attempt.created_at desc, attempt.id
  limit 1;
  select share.status into share_status
  from private.account_split_shares share
  join private.account_splits split on split.id = share.split_id
  where split.session_id = target_session and share.position = target_position
  order by split.created_at desc limit 1;
  return jsonb_build_object(
    'shareStatus', share_status,
    'payment', case when payment.id is null then null else
      jsonb_build_object(
        'paymentId', payment.id,
        'status', payment.status,
        'statusDetail', payment.provider_status_detail,
        'amountCents', payment.amount_cents,
        'refundedCents', payment.refunded_cents,
        'fulfillment', payment.fulfillment
      ) end);
end;
$$;

revoke all on function
  private.claim_share_for_payment(uuid),
  private.share_payment_json(private.online_payments),
  private.begin_share_online_payment(uuid, uuid, text, integer, bytea),
  private.share_payment_view(uuid, uuid, text, integer, bytea)
from public, anon, authenticated, authenticator;
grant execute on function
  private.begin_share_online_payment(uuid, uuid, text, integer, bytea),
  private.share_payment_view(uuid, uuid, text, integer, bytea)
to authenticator;

commit;
