begin;

-- Refuses to run once a share has been paid (or attempted) online.
do $guard$
begin
  if exists (select 1 from private.online_payments where share_split_id is not null) then
    raise exception 'share online payments exist: this migration cannot be rolled back';
  end if;
end;
$guard$;

drop function private.share_payment_view(uuid, uuid, text, integer, bytea);
drop function private.begin_share_online_payment(uuid, uuid, text, integer, bytea);

-- Take the share branch out of the reconciler.
do $unpatch$
declare
  definition text := pg_get_functiondef(
    'private.reconcile_online_payment(uuid,uuid,uuid,text,text,text,text,integer,integer,timestamptz)'::regprocedure
  );
  start_at integer := position(E'  if mapped = ''approved'' and payment.fulfillment = ''waiting''\n    and payment.share_split_id is not null' in definition);
  marker text := E'  elsif mapped = ''approved'' and payment.fulfillment = ''waiting'' then\n';
  stop_at integer := position(marker in definition);
begin
  if start_at = 0 or stop_at = 0 or stop_at < start_at then
    raise exception 'the share branch of the reconciler is not in place';
  end if;
  execute substr(definition, 1, start_at - 1)
    || E'  if mapped = ''approved'' and payment.fulfillment = ''waiting'' then\n'
    || substr(definition, stop_at + length(marker));
end;
$unpatch$;

drop function private.share_payment_json(private.online_payments);
drop function private.claim_share_for_payment(uuid);
drop index private.online_payments_active_share_idx;
alter table private.online_payments
  drop constraint online_payments_share_fkey,
  drop constraint online_payments_fulfillment_order_check,
  drop constraint online_payments_share_check,
  drop constraint online_payments_target_check,
  drop column share_position,
  drop column share_split_id,
  alter column intent_id set not null,
  add constraint online_payments_check3
    check ((fulfillment = 'confirmed') = (order_id is not null));

commit;
