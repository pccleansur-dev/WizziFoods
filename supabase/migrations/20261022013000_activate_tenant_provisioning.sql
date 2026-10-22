begin;

create function private.activate_tenant_provisioning(target_auth_user_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
declare
  activated boolean;
begin
  update private.tenant_provisioning_requests request
  set
    status = 'activated',
    activated_at = coalesce(request.activated_at, now()),
    updated_at = now()
  where request.auth_user_id = target_auth_user_id
    and request.status = 'invited'
    and exists (
      select 1
      from public.tenant_memberships membership
      where membership.tenant_id = request.tenant_id
        and membership.user_id = target_auth_user_id
        and membership.role = 'admin'
    );

  select exists (
    select 1
    from private.tenant_provisioning_requests request
    where request.auth_user_id = target_auth_user_id
      and request.status = 'activated'
  ) into activated;

  return activated;
end;
$$;

revoke all on function private.activate_tenant_provisioning(uuid)
from public, anon, authenticated;
grant usage on schema private to authenticator;
grant execute on function private.activate_tenant_provisioning(uuid)
to authenticator;

commit;
