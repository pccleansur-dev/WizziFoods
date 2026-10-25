begin;

-- Splitting an account into equal shares (T25).
--
-- A split freezes the pending balance at the moment it is made into N shares that
-- add up to it exactly (the remainder cents go to the first shares). Paying shares
-- is an ordinary in-person payment of their sum, so the ledger, the register and
-- every limit of T22/T23 keep applying. What the split adds is the claim: a share
-- is paid at most once, atomically, under the same lock that serializes the
-- account, so two simultaneous payments can never exceed the pending balance nor
-- take the same share. Consumption after the split simply stays as new pending
-- balance outside the shares.

create table private.account_splits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  location_id uuid not null,
  session_id uuid not null,
  parts integer not null check (parts between 2 and 20),
  base_pending_cents integer not null check (base_pending_cents >= parts),
  status text not null default 'open' check (status in ('open', 'done', 'superseded')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, location_id, session_id)
    references private.table_sessions(tenant_id, location_id, id) on delete restrict,
  foreign key (tenant_id, created_by)
    references public.staff_members(tenant_id, id) on delete restrict
);
create unique index account_splits_one_open_idx
  on private.account_splits (tenant_id, location_id, session_id)
  where status = 'open';

create table private.account_split_shares (
  split_id uuid not null references private.account_splits(id) on delete restrict,
  position integer not null check (position between 1 and 20),
  amount_cents integer not null check (amount_cents > 0),
  status text not null default 'open' check (status in ('open', 'paid', 'cancelled')),
  payer_label text check (payer_label = btrim(payer_label) and length(payer_label) between 1 and 40),
  payment_id uuid,
  paid_at timestamptz,
  primary key (split_id, position),
  check ((status = 'paid') = (payment_id is not null)),
  check (payer_label is null or status = 'paid')
);

create function private.guard_split_share_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.split_id <> old.split_id or new.position <> old.position
    or new.amount_cents <> old.amount_cents
    or old.status <> 'open'
    or new.status not in ('paid', 'cancelled')
  then
    raise exception 'a share can only be paid or cancelled once' using errcode = 'PT209';
  end if;
  return new;
end;
$$;
create trigger account_split_shares_guard
before update on private.account_split_shares
for each row execute function private.guard_split_share_change();
create trigger account_split_shares_no_delete
before delete on private.account_split_shares
for each row execute function private.reject_append_only_change();

create function private.guard_split_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status')
    or old.status <> 'open' or new.status not in ('done', 'superseded')
  then
    raise exception 'a split can only be closed once' using errcode = 'PT209';
  end if;
  return new;
end;
$$;
create trigger account_splits_guard
before update on private.account_splits
for each row execute function private.guard_split_change();
create trigger account_splits_no_delete
before delete on private.account_splits
for each row execute function private.reject_append_only_change();

revoke all on table private.account_splits, private.account_split_shares
from public, anon, authenticated, authenticator;

create function private.active_account_split(
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
    'splitId', split.id,
    'parts', split.parts,
    'baseCents', split.base_pending_cents,
    'shares', (
      select jsonb_agg(jsonb_build_object(
        'position', share.position,
        'amountCents', share.amount_cents,
        'status', share.status,
        'payerLabel', share.payer_label
      ) order by share.position)
      from private.account_split_shares share
      where share.split_id = split.id
    )
  )
  from private.account_splits split
  where split.tenant_id = target_tenant_id
    and split.location_id = target_location_id
    and split.session_id = target_session_id
    and split.status = 'open';
$$;

-- Shows the active split inside each account of the accounts view.
do $patch$
declare
  definition text := pg_get_functiondef(
    'private.waiter_accounts_view(uuid,uuid,uuid)'::regprocedure
  );
  anchor text := E'      ''entries'', coalesce((';
begin
  if position(anchor in definition) = 0 then
    raise exception 'waiter_accounts_view changed: patch anchor not found';
  end if;
  execute replace(
    definition, anchor,
    E'      ''split'', private.active_account_split(\n'
      || E'        target_tenant_id, target_location_id, account_session.id),\n'
      || anchor
  );
end;
$patch$;

create function private.create_account_split(
  target_tenant_id uuid,
  target_location_id uuid,
  target_staff_id uuid,
  target_command_id uuid,
  target_session_id uuid,
  target_parts integer
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
  pending integer;
  split_id uuid := gen_random_uuid();
begin
  stored := private.claim_waiter_command(
    target_tenant_id, target_location_id, target_staff_id, target_command_id,
    jsonb_build_object('kind', 'account_split', 'sessionId', target_session_id, 'parts', target_parts)
  );
  if stored is not null then
    return stored;
  end if;
  if target_parts is null or target_parts not between 2 and 20 then
    raise exception 'invalid split' using errcode = 'PT212';
  end if;
  perform 1 from private.table_sessions account_session
  where account_session.tenant_id = target_tenant_id
    and account_session.location_id = target_location_id
    and account_session.id = target_session_id
    and account_session.status = 'open'
  for update;
  if not found
    or not private.waiter_serves_session(
      target_tenant_id, target_location_id, target_staff_id, actor_role, target_session_id)
  then
    raise exception 'account not found' using errcode = 'PT201';
  end if;
  pending := (private.account_summary(
    target_tenant_id, target_location_id, target_session_id) ->> 'pendingCents')::integer;
  if pending <= 0 then
    raise exception 'nothing to split' using errcode = 'PT231';
  end if;
  if pending < target_parts then
    raise exception 'too many parts for the balance' using errcode = 'PT212';
  end if;

  -- A new split replaces the open one: its unpaid shares are void.
  update private.account_split_shares share
  set status = 'cancelled'
  where share.status = 'open'
    and share.split_id in (
      select split.id from private.account_splits split
      where split.tenant_id = target_tenant_id
        and split.location_id = target_location_id
        and split.session_id = target_session_id
        and split.status = 'open');
  update private.account_splits split
  set status = 'superseded'
  where split.tenant_id = target_tenant_id
    and split.location_id = target_location_id
    and split.session_id = target_session_id
    and split.status = 'open';

  insert into private.account_splits (
    id, tenant_id, location_id, session_id, parts, base_pending_cents, created_by
  ) values (
    split_id, target_tenant_id, target_location_id, target_session_id,
    target_parts, pending, target_staff_id);
  insert into private.account_split_shares (split_id, position, amount_cents)
  select split_id, n, pending / target_parts + case when n <= pending % target_parts then 1 else 0 end
  from generate_series(1, target_parts) n;

  perform private.append_audit_event(
    target_tenant_id, 'staff', target_staff_id, 'account.split_created',
    'Cuenta dividida en partes iguales', 'account:' || gen_random_uuid()::text,
    'table_session', target_session_id);

  return private.finish_waiter_command(
    target_tenant_id, target_location_id, target_staff_id, target_command_id,
    jsonb_build_object(
      'sessionId', target_session_id,
      'pendingCents', pending,
      'split', private.active_account_split(target_tenant_id, target_location_id, target_session_id)));
end;
$$;

create function private.pay_split_shares(
  target_tenant_id uuid,
  target_location_id uuid,
  target_staff_id uuid,
  target_command_id uuid,
  target_session_id uuid,
  target_split_id uuid,
  target_positions integer[],
  target_method text,
  target_tip_cents integer,
  target_payer_label text
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
  positions integer[];
  total integer;
  claimed integer;
  payment jsonb;
  label text := nullif(btrim(target_payer_label), '');
begin
  positions := (select array_agg(distinct p order by p) from unnest(target_positions) p);
  stored := private.claim_waiter_command(
    target_tenant_id, target_location_id, target_staff_id, target_command_id,
    jsonb_build_object('kind', 'split_payment', 'sessionId', target_session_id,
      'splitId', target_split_id, 'positions', positions, 'method', target_method,
      'tipCents', target_tip_cents, 'payerLabel', label));
  if stored is not null then
    return stored;
  end if;
  if positions is null or cardinality(positions) not between 1 and 20
    or (label is not null and length(label) > 40)
  then
    raise exception 'invalid split payment' using errcode = 'PT212';
  end if;
  -- The account lock serializes every payment and every claim of this table.
  perform 1 from private.table_sessions account_session
  where account_session.tenant_id = target_tenant_id
    and account_session.location_id = target_location_id
    and account_session.id = target_session_id
    and account_session.status = 'open'
  for update;
  if not found
    or not private.waiter_serves_session(
      target_tenant_id, target_location_id, target_staff_id, actor_role, target_session_id)
  then
    raise exception 'account not found' using errcode = 'PT201';
  end if;

  select count(*), coalesce(sum(share.amount_cents), 0)::integer into claimed, total
  from private.account_split_shares share
  join private.account_splits split on split.id = share.split_id
  where split.id = target_split_id
    and split.tenant_id = target_tenant_id
    and split.location_id = target_location_id
    and split.session_id = target_session_id
    and split.status = 'open'
    and share.status = 'open'
    and share.position = any(positions);
  if claimed <> cardinality(positions) then
    raise exception 'a share is no longer available' using errcode = 'PT260';
  end if;

  -- An ordinary payment of their sum: it fails, and so does the claim, if the
  -- balance fell below it or the register is closed.
  payment := private.record_account_payment(
    target_tenant_id, target_location_id, target_staff_id, gen_random_uuid(),
    target_session_id, target_method, total, target_tip_cents);

  update private.account_split_shares share
  set status = 'paid', payer_label = label,
      payment_id = (payment ->> 'paymentId')::uuid, paid_at = now()
  where share.split_id = target_split_id and share.position = any(positions);
  update private.account_splits split
  set status = 'done'
  where split.id = target_split_id
    and not exists (
      select 1 from private.account_split_shares share
      where share.split_id = split.id and share.status = 'open');

  return private.finish_waiter_command(
    target_tenant_id, target_location_id, target_staff_id, target_command_id,
    payment || jsonb_build_object(
      'splitId', target_split_id,
      'positions', to_jsonb(positions),
      'split', private.active_account_split(target_tenant_id, target_location_id, target_session_id)));
end;
$$;

revoke all on function
  private.active_account_split(uuid, uuid, uuid),
  private.create_account_split(uuid, uuid, uuid, uuid, uuid, integer),
  private.pay_split_shares(uuid, uuid, uuid, uuid, uuid, uuid, integer[], text, integer, text)
from public, anon, authenticated, authenticator;
grant execute on function
  private.create_account_split(uuid, uuid, uuid, uuid, uuid, integer),
  private.pay_split_shares(uuid, uuid, uuid, uuid, uuid, uuid, integer[], text, integer, text)
to authenticator;

commit;
