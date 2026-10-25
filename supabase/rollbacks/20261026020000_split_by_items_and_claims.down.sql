begin;

-- Destructive for item splits and claims: it refuses to run while an item split, an
-- assignment or a claimed share exists, because they could not be represented before.
do $guard$
begin
  if exists (select 1 from private.account_splits where kind = 'items')
    or exists (select 1 from private.account_split_assignments)
    or exists (select 1 from private.account_split_shares where status = 'claimed')
  then
    raise exception 'item splits or claims exist: this migration cannot be rolled back';
  end if;
end;
$guard$;

drop function private.release_split_share(uuid, uuid, text, integer, bytea);
drop function private.claim_split_share(uuid, uuid, text, integer, text, bytea);
drop function private.diner_account_split_view(uuid, uuid, text, bytea);
drop function private.diner_split_session(uuid, uuid, text);
drop function private.create_item_split(uuid, uuid, uuid, uuid, uuid, integer, jsonb);

-- Put the two function patches back as they were.
do $unpatch$
declare
  pay_def text := pg_get_functiondef(
    'private.pay_split_shares(uuid,uuid,uuid,uuid,uuid,uuid,integer[],text,integer,text)'::regprocedure
  );
  equal_def text := pg_get_functiondef(
    'private.create_account_split(uuid,uuid,uuid,uuid,uuid,integer)'::regprocedure
  );
  supersede text := E'  perform private.supersede_account_split(\n'
    || E'    target_tenant_id, target_location_id, target_session_id);\n';
begin
  if position(E'share.status in (''open'', ''claimed'')' in pay_def) = 0
    or position(supersede in equal_def) = 0
  then
    raise exception 'the T25 part 2 function patches are not in place';
  end if;
  execute replace(
    replace(
      replace(pay_def, E'share.status in (''open'', ''claimed'')', E'share.status = ''open'''),
      E'payer_label = coalesce(label, share.payer_label),',
      E'payer_label = label,'
    ),
    E'share.status = ''open'' or',
    E'share.status = ''open'' or'
  );
  execute replace(
    equal_def, supersede,
    E'  -- A new split replaces the open one: its unpaid shares are void.\n'
      || E'  update private.account_split_shares share\n'
      || E'  set status = ''cancelled''\n'
      || E'  where share.status = ''open''\n'
      || E'    and share.split_id in (\n'
      || E'      select split.id from private.account_splits split\n'
      || E'      where split.tenant_id = target_tenant_id\n'
      || E'        and split.location_id = target_location_id\n'
      || E'        and split.session_id = target_session_id\n'
      || E'        and split.status = ''open'');\n'
      || E'  update private.account_splits split\n'
      || E'  set status = ''superseded''\n'
      || E'  where split.tenant_id = target_tenant_id\n'
      || E'    and split.location_id = target_location_id\n'
      || E'    and split.session_id = target_session_id\n'
      || E'    and split.status = ''open'';\n'
  );
end;
$unpatch$;
drop function private.supersede_account_split(uuid, uuid, uuid);

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

create or replace function private.guard_split_share_change()
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

alter table private.account_split_shares
  drop constraint account_split_shares_claim_state,
  drop constraint account_split_shares_label_state,
  drop column claimed_at,
  drop column claimed_hash,
  drop constraint account_split_shares_status_check,
  add constraint account_split_shares_status_check
    check (status in ('open', 'paid', 'cancelled')),
  add constraint account_split_shares_check1
    check (payer_label is null or status = 'paid');

drop table private.account_split_assignments;
alter table private.account_splits drop column kind;

commit;
