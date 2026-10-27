begin;

drop trigger account_split_assignments_diner_realtime on private.account_split_assignments;
drop trigger account_split_shares_diner_realtime on private.account_split_shares;
drop trigger table_group_events_diner_realtime on private.table_group_events;
drop trigger table_sessions_diner_realtime on private.table_sessions;
drop trigger floor_group_members_diner_realtime on private.floor_group_members;
drop trigger floor_table_service_states_diner_realtime on private.floor_table_service_states;

drop function private.rt_diner_split();
drop function private.rt_diner_group_event();
drop function private.rt_diner_session();
drop function private.rt_diner_table();
drop function private.session_tables(uuid, uuid, uuid, uuid);
drop function private.notify_tables(uuid, uuid, uuid[]);

commit;
