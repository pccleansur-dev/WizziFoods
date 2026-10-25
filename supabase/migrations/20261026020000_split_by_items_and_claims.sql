begin;

-- Splitting by consumption and claiming a share from the phone (T25, part 2).
--
-- A split by items assigns live items to people; the shared ones (assigned to nobody)
-- are divided equally. Each person's share is their weight over the PENDING balance
-- (largest remainder, so the shares add up to it exactly), which keeps discounts,
-- previous payments and tips consistent. A diner can reserve ("claim") a share from the
-- table's QR token; the claim is atomic under the same account lock, belongs to a secret
-- only that device knows, and the waiter collects it like any other share.

alter table private.account_splits
  add column kind text not null default 'equal' check (kind in ('equal', 'items'));

create table private.account_split_assignments (
  split_id uuid not null references private.account_splits(id) on delete restrict,
  line_id uuid not null,
  position integer not null check (position between 1 and 20),
  primary key (split_id, line_id)
);
create trigger account_split_assignments_immutable
before update or delete on private.account_split_assignments
for each row execute function private.reject_append_only_change();
revoke all on table private.account_split_assignments
from public, anon, authenticated, authenticator;

alter table private.account_split_shares
  drop constraint account_split_shares_status_check,
  drop constraint account_split_shares_check1,
  add constraint account_split_shares_status_check
    check (status in ('open', 'claimed', 'paid', 'cancelled')),
  add column claimed_hash bytea check (octet_length(claimed_hash) = 32),
  add column claimed_at timestamptz,
  add constraint account_split_shares_label_state
    check (payer_label is null or status in ('claimed', 'paid')),
  add constraint account_split_shares_claim_state
    check (status <> 'claimed' or (claimed_hash is not null and claimed_at is not null));

create or replace function private.guard_split_share_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.split_id <> old.split_id or new.position <> old.position
    or new.amount_cents <> old.amount_cents
    or old.status in ('paid', 'cancelled')
    or old.status = new.status
    or (old.status = 'claimed' and new.status = 'open'
      and (new.payer_label is not null or new.claimed_hash is not null))
  then
    raise exception 'a share can only be claimed, released, paid or cancelled in order'
      using errcode = 'PT209';
  end if;
  return new;
end;
$$;

create or replace function private.active_account_split(
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
    'kind', split.kind,
    'parts', split.parts,
    'baseCents', split.base_pending_cents,
    'sharedItems', coalesce((
      select jsonb_agg(item.quantity || ' × ' || item.title order by item.position, item.line_id)
      from private.confirmed_order_items item
      join private.confirmed_orders confirmed
        on confirmed.tenant_id = item.tenant_id
        and confirmed.location_id = item.location_id
        and confirmed.id = item.order_id
      where split.kind = 'items'
        and confirmed.session_id = split.session_id
        and item.tenant_id = split.tenant_id
        and item.location_id = split.location_id
        and item.total_cents > 0
        and not exists (
          select 1 from private.account_split_assignments assigned
          where assigned.split_id = split.id and assigned.line_id = item.line_id)
        and not exists (
          select 1 from private.order_adjustments adjustment
          where adjustment.tenant_id = item.tenant_id
            and adjustment.location_id = item.location_id
            and adjustment.order_id = item.order_id
            and adjustment.original_line_id = item.line_id
            and (adjustment.kind = 'cancellation'
              or (adjustment.kind = 'replacement' and adjustment.status = 'accepted')))
    ), '[]'::jsonb),
    'shares', (
      select jsonb_agg(jsonb_build_object(
        'position', share.position,
        'amountCents', share.amount_cents,
        'status', share.status,
        'payerLabel', share.payer_label,
        'items', coalesce((
          select jsonb_agg(item.quantity || ' × ' || item.title order by item.position, item.line_id)
          from private.account_split_assignments assigned
          join private.confirmed_order_items item
            on item.tenant_id = split.tenant_id
            and item.location_id = split.location_id
            and item.line_id = assigned.line_id
          where assigned.split_id = split.id and assigned.position = share.position
        ), '[]'::jsonb)
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

-- Voids the open split of an account (claimed shares included) before a new one.
create function private.supersede_account_split(
  target_tenant_id uuid,
  target_location_id uuid,
  target_session_id uuid
)
returns void
language sql
volatile
security definer
set search_path = ''
set row_security = off
as $$
  update private.account_split_shares share
  set status = 'cancelled', payer_label = null
  where share.status in ('open', 'claimed')
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
$$;

-- The equal split now voids claimed shares too.
do $patch$
declare
  definition text := pg_get_functiondef(
    'private.create_account_split(uuid,uuid,uuid,uuid,uuid,integer)'::regprocedure
  );
  start_at integer := position(E'  -- A new split replaces the open one' in definition);
  stop_at integer := position(E'  insert into private.account_splits (' in definition);
begin
  if start_at = 0 or stop_at = 0 or stop_at < start_at then
    raise exception 'create_account_split changed: patch anchors not found';
  end if;
  execute substr(definition, 1, start_at - 1)
    || E'  perform private.supersede_account_split(\n'
    || E'    target_tenant_id, target_location_id, target_session_id);\n\n'
    || substr(definition, stop_at);
end;
$patch$;

-- An item split. `assignments` is [{lineId, position}] for the items someone owns.
create function private.create_item_split(
  target_tenant_id uuid,
  target_location_id uuid,
  target_staff_id uuid,
  target_command_id uuid,
  target_session_id uuid,
  target_persons integer,
  target_assignments jsonb
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
  live jsonb;
  assigned jsonb := coalesce(target_assignments, '[]'::jsonb);
  items_total integer;
  assigned_total integer;
  total_weight numeric;
  amounts integer[];
  split_id uuid := gen_random_uuid();
begin
  stored := private.claim_waiter_command(
    target_tenant_id, target_location_id, target_staff_id, target_command_id,
    jsonb_build_object('kind', 'item_split', 'sessionId', target_session_id,
      'persons', target_persons, 'assignments', assigned));
  if stored is not null then
    return stored;
  end if;
  if target_persons is null or target_persons not between 2 and 20
    or jsonb_typeof(assigned) <> 'array' or jsonb_array_length(assigned) > 200
  then
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

  select coalesce(jsonb_agg(jsonb_build_object('lineId', item.line_id, 'total', item.total_cents)), '[]'::jsonb),
    coalesce(sum(item.total_cents), 0)::integer
  into live, items_total
  from private.confirmed_order_items item
  join private.confirmed_orders confirmed
    on confirmed.tenant_id = item.tenant_id
    and confirmed.location_id = item.location_id
    and confirmed.id = item.order_id
  where confirmed.session_id = target_session_id
    and item.tenant_id = target_tenant_id
    and item.location_id = target_location_id
    and item.total_cents > 0
    and not exists (
      select 1 from private.order_adjustments adjustment
      where adjustment.tenant_id = item.tenant_id
        and adjustment.location_id = item.location_id
        and adjustment.order_id = item.order_id
        and adjustment.original_line_id = item.line_id
      and (adjustment.kind = 'cancellation'
        or (adjustment.kind = 'replacement' and adjustment.status = 'accepted')));
  if items_total <= 0 then
    raise exception 'no items to split' using errcode = 'PT212';
  end if;

  -- Every assignment points at a live item of this account, once, to a real person.
  if exists (
    select 1 from jsonb_to_recordset(assigned) as entry("lineId" uuid, "position" integer)
    where entry."lineId" is null or entry."position" is null
      or entry."position" not between 1 and target_persons
      or not exists (
        select 1 from jsonb_to_recordset(live) as item("lineId" uuid, total integer)
        where item."lineId" = entry."lineId"))
    or (select count(distinct entry."lineId")
        from jsonb_to_recordset(assigned) as entry("lineId" uuid, "position" integer))
      <> jsonb_array_length(assigned)
  then
    raise exception 'invalid assignment' using errcode = 'PT212';
  end if;

  select coalesce(sum(item.total), 0)::integer into assigned_total
  from jsonb_to_recordset(assigned) as entry("lineId" uuid, "position" integer)
  join jsonb_to_recordset(live) as item("lineId" uuid, total integer)
    on item."lineId" = entry."lineId";
  total_weight := items_total::numeric * target_persons;

  -- Weight of a person: what they own, times the people, plus the shared remainder.
  with people as (select generate_series(1, target_persons) as position),
    weights as (
      select people.position,
        (coalesce((
          select sum(item.total)
          from jsonb_to_recordset(assigned) as entry("lineId" uuid, "position" integer)
          join jsonb_to_recordset(live) as item("lineId" uuid, total integer)
            on item."lineId" = entry."lineId"
          where entry."position" = people.position), 0)::numeric * target_persons
          + (items_total - assigned_total)) as weight
      from people),
    exact as (
      select position, pending::numeric * weight / total_weight as share
      from weights),
    ranked as (
      select position, floor(share) as base, share - floor(share) as fraction,
        row_number() over (order by share - floor(share) desc, position) as rank,
        sum(floor(share)) over () as base_sum
      from exact)
  select array_agg((base + case when rank <= pending - base_sum then 1 else 0 end)::integer
      order by position)
  into amounts
  from ranked;
  if exists (select 1 from unnest(amounts) amount where amount <= 0) then
    raise exception 'a person would owe nothing' using errcode = 'PT212';
  end if;

  perform private.supersede_account_split(
    target_tenant_id, target_location_id, target_session_id);
  insert into private.account_splits (
    id, tenant_id, location_id, session_id, parts, base_pending_cents, created_by, kind
  ) values (
    split_id, target_tenant_id, target_location_id, target_session_id,
    target_persons, pending, target_staff_id, 'items');
  insert into private.account_split_shares (split_id, position, amount_cents)
  select split_id, ordinality::integer, amount
  from unnest(amounts) with ordinality as share(amount, ordinality);
  insert into private.account_split_assignments (split_id, line_id, position)
  select split_id, entry."lineId", entry."position"
  from jsonb_to_recordset(assigned) as entry("lineId" uuid, "position" integer);

  perform private.append_audit_event(
    target_tenant_id, 'staff', target_staff_id, 'account.item_split_created',
    'Cuenta dividida por consumo', 'account:' || gen_random_uuid()::text,
    'table_session', target_session_id);

  return private.finish_waiter_command(
    target_tenant_id, target_location_id, target_staff_id, target_command_id,
    jsonb_build_object(
      'sessionId', target_session_id,
      'pendingCents', pending,
      'split', private.active_account_split(target_tenant_id, target_location_id, target_session_id)));
end;
$$;

-- The staff collects a claimed share as well as an open one.
do $patch$
declare
  definition text := pg_get_functiondef(
    'private.pay_split_shares(uuid,uuid,uuid,uuid,uuid,uuid,integer[],text,integer,text)'::regprocedure
  );
  open_only text := E'    and share.status = ''open''\n';
  label_set text := E'  set status = ''paid'', payer_label = label,';
  done_only text := E'where share.split_id = split.id and share.status = ''open'');';
begin
  if position(open_only in definition) = 0 or position(label_set in definition) = 0
    or position(done_only in definition) = 0
  then
    raise exception 'pay_split_shares changed: patch anchors not found';
  end if;
  -- A claimed share still blocks the split from closing.
  execute replace(
    replace(
      replace(definition, open_only, E'    and share.status in (''open'', ''claimed'')\n'),
      label_set,
      E'  set status = ''paid'', payer_label = coalesce(label, share.payer_label),'
    ),
    done_only,
    E'where share.split_id = split.id and share.status in (''open'', ''claimed''));'
  );
end;
$patch$;

-- Diner side ---------------------------------------------------------------------------------

create function private.diner_split_session(
  target_tenant_id uuid,
  target_location_id uuid,
  target_token text
)
returns uuid
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select account_session.id
  from private.floor_table_qr_codes qr
  join private.table_sessions account_session
    on account_session.tenant_id = qr.tenant_id
    and account_session.location_id = qr.location_id
    and account_session.status = 'open'
    and account_session.scope_key = coalesce((
      select member.group_id from private.floor_group_members member
      where member.tenant_id = qr.tenant_id
        and member.location_id = qr.location_id
        and member.table_id = qr.table_id), qr.table_id)
  where qr.tenant_id = target_tenant_id
    and qr.location_id = target_location_id
    and qr.token = target_token
    and qr.status = 'active';
$$;

-- What the diner sees: the shares of the table's split, and which are theirs.
create function private.diner_account_split_view(
  target_tenant_id uuid,
  target_location_id uuid,
  target_token text,
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
  account_id uuid := private.diner_split_session(
    target_tenant_id, target_location_id, target_token);
  split private.account_splits%rowtype;
begin
  if account_id is null then
    return jsonb_build_object('pendingCents', 0, 'split', null);
  end if;
  select * into split
  from private.account_splits candidate
  where candidate.tenant_id = target_tenant_id
    and candidate.location_id = target_location_id
    and candidate.session_id = account_id
    and candidate.status = 'open';
  return jsonb_build_object(
    'pendingCents', (private.account_summary(
      target_tenant_id, target_location_id, account_id) ->> 'pendingCents')::integer,
    'split', case when split.id is null then null else
      jsonb_build_object(
        'splitId', split.id,
        'kind', split.kind,
        'shares', (
          select jsonb_agg(jsonb_build_object(
            'position', share.position,
            'amountCents', share.amount_cents,
            'status', share.status,
            'claimedBy', case when share.status = 'claimed' then share.payer_label end,
            'mine', share.status = 'claimed'
              and share.claimed_hash is not distinct from target_secret_hash,
            'items', coalesce((
              select jsonb_agg(item.quantity || ' × ' || item.title order by item.position, item.line_id)
              from private.account_split_assignments assigned
              join private.confirmed_order_items item
                on item.tenant_id = split.tenant_id
                and item.location_id = split.location_id
                and item.line_id = assigned.line_id
              where assigned.split_id = split.id and assigned.position = share.position
            ), '[]'::jsonb)
          ) order by share.position)
          from private.account_split_shares share
          where share.split_id = split.id)
      ) end);
end;
$$;

create function private.claim_split_share(
  target_tenant_id uuid,
  target_location_id uuid,
  target_token text,
  target_position integer,
  target_label text,
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
  account_id uuid := private.diner_split_session(
    target_tenant_id, target_location_id, target_token);
  label text := btrim(coalesce(target_label, ''));
  claimed integer;
begin
  if account_id is null then
    raise exception 'account not found' using errcode = 'PT201';
  end if;
  if length(label) not between 1 and 40 or target_secret_hash is null
    or octet_length(target_secret_hash) <> 32
    or target_position is null or target_position not between 1 and 20
  then
    raise exception 'invalid claim' using errcode = 'PT212';
  end if;
  perform 1 from private.table_sessions account_session
  where account_session.tenant_id = target_tenant_id
    and account_session.location_id = target_location_id
    and account_session.id = account_id
  for update;
  update private.account_split_shares share
  set status = 'claimed', payer_label = label,
      claimed_hash = target_secret_hash, claimed_at = now()
  where share.position = target_position
    and share.status = 'open'
    and share.split_id in (
      select split.id from private.account_splits split
      where split.tenant_id = target_tenant_id
        and split.location_id = target_location_id
        and split.session_id = account_id
        and split.status = 'open');
  get diagnostics claimed = row_count;
  if claimed = 0 then
    raise exception 'that share is no longer available' using errcode = 'PT260';
  end if;
  return private.diner_account_split_view(
    target_tenant_id, target_location_id, target_token, target_secret_hash);
end;
$$;

create function private.release_split_share(
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
  account_id uuid := private.diner_split_session(
    target_tenant_id, target_location_id, target_token);
  released integer;
begin
  if account_id is null then
    raise exception 'account not found' using errcode = 'PT201';
  end if;
  perform 1 from private.table_sessions account_session
  where account_session.tenant_id = target_tenant_id
    and account_session.location_id = target_location_id
    and account_session.id = account_id
  for update;
  update private.account_split_shares share
  set status = 'open', payer_label = null, claimed_hash = null, claimed_at = null
  where share.position = target_position
    and share.status = 'claimed'
    and share.claimed_hash = target_secret_hash
    and share.split_id in (
      select split.id from private.account_splits split
      where split.tenant_id = target_tenant_id
        and split.location_id = target_location_id
        and split.session_id = account_id
        and split.status = 'open');
  get diagnostics released = row_count;
  if released = 0 then
    raise exception 'that share is not yours' using errcode = 'PT260';
  end if;
  return private.diner_account_split_view(
    target_tenant_id, target_location_id, target_token, target_secret_hash);
end;
$$;

revoke all on function
  private.supersede_account_split(uuid, uuid, uuid),
  private.create_item_split(uuid, uuid, uuid, uuid, uuid, integer, jsonb),
  private.diner_split_session(uuid, uuid, text),
  private.diner_account_split_view(uuid, uuid, text, bytea),
  private.claim_split_share(uuid, uuid, text, integer, text, bytea),
  private.release_split_share(uuid, uuid, text, integer, bytea)
from public, anon, authenticated, authenticator;
grant execute on function
  private.create_item_split(uuid, uuid, uuid, uuid, uuid, integer, jsonb),
  private.diner_account_split_view(uuid, uuid, text, bytea),
  private.claim_split_share(uuid, uuid, text, integer, text, bytea),
  private.release_split_share(uuid, uuid, text, integer, bytea)
to authenticator;

commit;
