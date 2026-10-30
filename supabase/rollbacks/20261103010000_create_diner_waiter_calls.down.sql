begin;

-- Destructive: the calls a diner opened are deleted. Only meant for a database
-- that never operated for real, or after the waiters closed them.

drop function if exists private.resolve_waiter_call(uuid, uuid, uuid, uuid, uuid);
drop function if exists private.create_waiter_call(uuid, uuid, text, text);

-- Puts the order-validation-only placeholders back in the salon view.
do $unpatch$
declare
  definition text;
begin
  select pg_get_functiondef('private.waiter_salon_view(uuid,uuid,uuid)'::regprocedure)
  into definition;
  definition := replace(definition,
    $e$select call.id, call.table_id, call.intent_id, call.payment_method, call.reason,$e$,
    $e$select call.id, call.table_id, call.intent_id, call.payment_method,$e$);
  definition := replace(definition,
    $e$'reason', open_calls.reason,$e$,
    $e$'reason', 'order_validation',$e$);
  execute definition;
end
$unpatch$;

delete from private.waiter_calls where reason <> 'order_validation';

drop index if exists private.waiter_calls_diner_recent_idx;
drop index if exists private.waiter_calls_one_live_per_reason;

alter table private.waiter_calls
  drop constraint if exists waiter_calls_reason_shape,
  drop constraint if exists waiter_calls_reason_check,
  alter column intent_id set not null,
  alter column payment_method set not null,
  add constraint waiter_calls_reason_check check (reason = 'order_validation');

commit;
