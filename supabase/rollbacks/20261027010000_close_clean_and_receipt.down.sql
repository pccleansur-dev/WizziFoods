begin;

-- Destructive: drops every receipt, the receipt counters and the cashier requests.
-- Sessions stay closed and tables stay pending cleaning; nothing is reopened.
drop function private.closed_accounts_view(uuid, uuid, uuid);
drop function private.resolve_cashier_request(uuid, uuid, uuid, uuid, uuid);
drop function private.request_cashier(uuid, uuid, uuid, uuid, uuid);
drop function private.account_receipt(uuid, uuid, uuid, uuid);
drop function private.mark_table_clean(uuid, uuid, uuid, uuid, uuid);
drop function private.close_table_session(uuid, uuid, uuid, uuid, uuid);
drop function private.build_account_receipt(uuid, uuid, uuid, integer, timestamptz, timestamptz);
drop function private.session_table_ids(uuid, uuid, uuid);
drop function private.waiter_serves_any_session(uuid, uuid, uuid, text, uuid);

drop trigger account_entries_guard_closed_session on private.account_entries;
drop function private.guard_closed_session_entry();

drop table private.cashier_requests;
drop function private.guard_cashier_request_change();
drop table private.account_receipts;
drop table private.receipt_counters;

drop trigger floor_table_service_states_guard_change on private.floor_table_service_states;
drop function private.guard_table_service_state_change();

commit;
