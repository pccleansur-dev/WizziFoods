begin;

-- Destructive: drops visits, rewards, birthdays and loyalty settings. Sessions, the ledger
-- and diner profiles are untouched (nothing there references these tables).
drop trigger account_entries_revoke_visits on private.account_entries;
drop trigger table_sessions_credit_visits on private.table_sessions;

drop function private.redeem_loyalty_reward_with_payment(uuid, uuid, uuid, uuid, uuid, uuid, text, integer);
drop function private.session_loyalty_rewards(uuid, uuid, uuid, uuid);
drop function private.release_loyalty_reward(uuid, uuid, uuid, uuid);
drop function private.reserve_loyalty_reward(uuid, uuid, uuid, uuid, uuid);
drop function private.save_diner_birthday(uuid, uuid, uuid, integer, integer);
drop function private.get_diner_loyalty(uuid, uuid, uuid);
drop function private.loyalty_birthday_json(uuid, uuid);
drop function private.save_loyalty_settings(uuid, uuid, uuid, jsonb);
drop function private.get_loyalty_settings(uuid, uuid, uuid);
drop function private.loyalty_settings_json(uuid, uuid);
drop function private.on_refund_revoke_visits();
drop function private.revoke_session_visits(uuid, uuid, uuid);
drop function private.on_session_closed_credit_visits();
drop function private.credit_session_visits(uuid, uuid, uuid);
drop function private.grant_loyalty_rewards(uuid, uuid, uuid);
drop function private.release_expired_rewards(uuid, uuid);
drop function private.loyalty_reward_cents(private.loyalty_rewards, integer);
drop function private.loyalty_local_day(uuid, timestamptz);

drop table private.diner_birthdays;
drop table private.loyalty_visits;
drop function private.guard_loyalty_visit_change();
drop table private.loyalty_rewards;
drop table private.loyalty_settings;

commit;
