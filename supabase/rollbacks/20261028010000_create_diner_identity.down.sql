begin;

-- Destructive: drops diner accounts, profiles, consent history and session links.
-- Sessions, orders and the ledger are untouched (nothing there references these tables).
drop function private.anonymize_diner_account(uuid);
drop function private.export_diner_data(uuid);
drop function private.list_tenant_diner_profiles(uuid);
drop function private.link_diner_to_session(uuid, uuid, uuid, text);
drop function private.record_diner_consent(uuid, uuid, uuid, text, text, integer, text);
drop function private.save_diner_profile(uuid, uuid, text, text);
drop function private.get_diner_profile(uuid, uuid);
drop function private.diner_profile_id_of(uuid, uuid);
drop function private.revoke_diner_session(uuid, bytea);
drop function private.resolve_diner_session(uuid, bytea);
drop function private.redeem_diner_login(uuid, bytea, bytea);
drop function private.create_diner_login_exchange(uuid, uuid, bytea);
drop function private.upsert_diner_account(text, text);
drop function private.diner_account_guard(uuid, boolean);
drop function private.diner_profile_json(uuid, uuid);
drop function private.diner_current_consent_texts(uuid);
drop function private.diner_consent_state(uuid, uuid, text);

drop table private.diner_session_links;
drop table private.diner_consent_events;
drop table private.diner_consent_texts;
drop table private.diner_profile_links;
drop table private.diner_profiles;
drop table private.diner_login_exchanges;
drop table private.diner_sessions;
drop table private.diner_accounts;

commit;
