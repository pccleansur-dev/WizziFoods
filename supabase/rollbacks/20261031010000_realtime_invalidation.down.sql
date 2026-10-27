begin;

drop trigger production_items_realtime on private.production_items;
drop trigger cash_movements_realtime on private.cash_movements;
drop trigger cash_shifts_realtime on private.cash_shifts;
drop trigger account_entries_realtime on private.account_entries;
drop trigger floor_tables_realtime on private.floor_tables;
drop trigger table_group_events_realtime on private.table_group_events;
drop trigger cashier_requests_realtime on private.cashier_requests;
drop trigger table_sessions_realtime on private.table_sessions;
drop trigger confirmed_orders_realtime on private.confirmed_orders;
drop trigger order_intents_realtime on private.order_intents;
drop trigger waiter_calls_realtime on private.waiter_calls;

drop function private.rt_production();
drop function private.rt_ledger();
drop function private.rt_cash();
drop function private.rt_salon();
drop function private.notify_realtime(uuid, uuid, text);

drop policy staff_receive_invalidations on realtime.messages;

commit;
