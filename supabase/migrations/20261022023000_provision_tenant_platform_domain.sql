begin;

create function private.begin_tenant_provisioning_with_domain(
  actor_user_id uuid,
  target_idempotency_key_hash text,
  target_request_fingerprint text,
  target_slug text,
  target_name text,
  target_admin_email text,
  target_platform_hostname text
)
returns table (
  request_id uuid,
  tenant_id uuid,
  tenant_slug text,
  tenant_name text,
  location_id uuid,
  location_name text,
  admin_email text,
  provisioning_status text,
  auth_user_id uuid,
  tenant_hostname text
)
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
declare
  provisioning record;
  assigned_hostname text;
begin
  select * into strict provisioning
  from private.begin_tenant_provisioning(
    actor_user_id,
    target_idempotency_key_hash,
    target_request_fingerprint,
    target_slug,
    target_name,
    target_admin_email
  );

  select domain.hostname into assigned_hostname
  from public.tenant_domains domain
  where domain.tenant_id = provisioning.tenant_id
    and domain.kind = 'platform_subdomain'
    and domain.is_primary;

  if assigned_hostname is null then
    insert into public.tenant_domains (
      tenant_id,
      hostname,
      kind,
      status,
      is_primary
    ) values (
      provisioning.tenant_id,
      target_platform_hostname,
      'platform_subdomain',
      'active',
      true
    )
    returning hostname into assigned_hostname;
  end if;

  return query
  select
    provisioning.request_id::uuid,
    provisioning.tenant_id::uuid,
    provisioning.tenant_slug::text,
    provisioning.tenant_name::text,
    provisioning.location_id::uuid,
    provisioning.location_name::text,
    provisioning.admin_email::text,
    provisioning.provisioning_status::text,
    provisioning.auth_user_id::uuid,
    assigned_hostname;
end;
$$;

create function private.complete_tenant_provisioning_with_domain(
  actor_user_id uuid,
  target_request_id uuid,
  target_auth_user_id uuid
)
returns table (
  request_id uuid,
  tenant_id uuid,
  tenant_slug text,
  tenant_name text,
  location_id uuid,
  location_name text,
  admin_email text,
  provisioning_status text,
  auth_user_id uuid,
  tenant_hostname text
)
language sql
volatile
security definer
set search_path = ''
set row_security = off
as $$
  with provisioning as materialized (
    select *
    from private.complete_tenant_provisioning(
      actor_user_id,
      target_request_id,
      target_auth_user_id
    )
  )
  select
    provisioning.request_id,
    provisioning.tenant_id,
    provisioning.tenant_slug,
    provisioning.tenant_name,
    provisioning.location_id,
    provisioning.location_name,
    provisioning.admin_email,
    provisioning.provisioning_status,
    provisioning.auth_user_id,
    domain.hostname
  from provisioning
  inner join public.tenant_domains domain
    on domain.tenant_id = provisioning.tenant_id
    and domain.kind = 'platform_subdomain'
    and domain.is_primary;
$$;

revoke all on function private.begin_tenant_provisioning_with_domain(
  uuid, text, text, text, text, text, text
) from public, anon, authenticated;
revoke all on function private.complete_tenant_provisioning_with_domain(
  uuid, uuid, uuid
) from public, anon, authenticated;
grant usage on schema private to authenticator;
grant execute on function private.begin_tenant_provisioning_with_domain(
  uuid, text, text, text, text, text, text
) to authenticator;
grant execute on function private.complete_tenant_provisioning_with_domain(
  uuid, uuid, uuid
) to authenticator;

commit;
