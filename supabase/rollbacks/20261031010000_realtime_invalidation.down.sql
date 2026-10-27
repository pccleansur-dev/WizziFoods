begin;

drop trigger production_items_realtime on private.production_items;
drop trigger account_split_shares_realtime on private.account_split_shares;
drop trigger account_split_assignments_realtime on private.account_split_assignments;
drop trigger account_splits_realtime on private.account_splits;
drop trigger account_decisions_realtime on private.account_decisions;
drop trigger order_adjustments_realtime on private.order_adjustments;
drop trigger online_payments_realtime on private.online_payments;
drop trigger floor_table_service_states_realtime on private.floor_table_service_states;
drop trigger floor_groups_realtime on private.floor_groups;
drop trigger floor_group_members_realtime on private.floor_group_members;
drop trigger staff_sector_assignments_realtime on private.staff_sector_assignments;
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

drop function private.rt_split_part();
drop function private.rt_production();
drop function private.rt_ledger();
drop function private.rt_cash();
drop function private.rt_salon();
drop function private.notify_realtime(uuid, uuid, text);

drop policy staff_receive_invalidations on realtime.messages;

commit;
