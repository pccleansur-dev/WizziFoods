begin;

create or replace function private.is_auth_session_active(
  target_session_id uuid,
  target_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select exists (
    select 1
    from auth.sessions
    where id = target_session_id
      and user_id = target_user_id
      and (not_after is null or not_after > now())
  );
$$;

revoke all on function private.is_auth_session_active(uuid, uuid)
from public, anon;
grant execute on function private.is_auth_session_active(uuid, uuid)
to authenticated;

commit;
