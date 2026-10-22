begin;

drop function if exists private.lock_staff_revalidation_candidate(text);
drop function if exists private.resolve_staff_session(text);
drop function if exists private.lock_staff_login_candidate(uuid, text);
drop function if exists private.resolve_active_staff_tenant(text);
revoke usage, select on sequence private.staff_auth_events_id_seq from authenticator;
revoke insert on table private.staff_auth_events from authenticator;
revoke select, insert, update on table private.staff_sessions from authenticator;
revoke select, insert, update on table private.staff_credentials from authenticator;
revoke usage on schema private from authenticator;

commit;
