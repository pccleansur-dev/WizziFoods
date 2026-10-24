begin;

-- Payment methods (T14).
-- Public provider configuration and the provider credential live apart. The
-- credential arrives already encrypted by the API (AES-256-GCM, key outside the
-- database) and no function returns it: reads report state only.

create table private.payment_methods (
  id uuid not null default gen_random_uuid() unique,
  tenant_id uuid not null,
  location_id uuid not null,
  method_key text not null check (
    method_key in (
      'cash', 'credit_card', 'debit_card', 'other_in_person', 'mercado_pago'
    )
  ),
  enabled boolean not null default false,
  public_config jsonb not null default '{}'::jsonb,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, location_id, method_key),
  foreign key (tenant_id, location_id)
    references public.locations(tenant_id, id)
    on delete cascade,
  foreign key (tenant_id, updated_by)
    references public.tenant_memberships(tenant_id, user_id)
    on delete restrict,
  constraint payment_methods_public_config_valid check (
    jsonb_typeof(public_config) = 'object'
    and (
      public_config = '{}'::jsonb
      or (
        method_key = 'mercado_pago'
        and (public_config - 'publicKey') = '{}'::jsonb
        and jsonb_typeof(public_config -> 'publicKey') = 'string'
        and (public_config ->> 'publicKey') ~ '^[A-Za-z0-9_-]{8,200}$'
      )
    )
  )
);

create table private.payment_method_secrets (
  tenant_id uuid not null,
  location_id uuid not null,
  method_key text not null check (method_key = 'mercado_pago'),
  ciphertext bytea not null check (octet_length(ciphertext) between 29 and 4096),
  key_version smallint not null check (key_version between 1 and 32000),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, location_id, method_key),
  foreign key (tenant_id, location_id, method_key)
    references private.payment_methods(tenant_id, location_id, method_key)
    on delete cascade
);

revoke all on table private.payment_methods, private.payment_method_secrets
from public, anon, authenticated, authenticator;

-- A method is available when the diner or staff can really use it.
create or replace function private.payment_method_available(
  target_tenant_id uuid,
  target_location_id uuid,
  target_method_key text,
  target_enabled boolean,
  target_public_config jsonb
)
returns boolean
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select target_enabled and (
    target_method_key <> 'mercado_pago'
    or (
      target_public_config ? 'publicKey'
      and exists (
        select 1
        from private.payment_method_secrets secret
        where secret.tenant_id = target_tenant_id
          and secret.location_id = target_location_id
          and secret.method_key = target_method_key
      )
    )
  );
$$;

create or replace function private.payment_available_count(
  target_tenant_id uuid,
  target_location_id uuid
)
returns integer
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select count(*)::integer
  from private.payment_methods method
  where method.tenant_id = target_tenant_id
    and method.location_id = target_location_id
    and private.payment_method_available(
      method.tenant_id, method.location_id, method.method_key,
      method.enabled, method.public_config
    );
$$;

-- Transactional backstop: whatever writes the rows, a location that has
-- payment methods always keeps at least one available at commit.
create or replace function private.payment_methods_require_available()
returns trigger
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  affected_tenant uuid := coalesce(new.tenant_id, old.tenant_id);
  affected_location uuid := coalesce(new.location_id, old.location_id);
begin
  if exists (
    select 1 from private.payment_methods method
    where method.tenant_id = affected_tenant
      and method.location_id = affected_location
  ) and private.payment_available_count(affected_tenant, affected_location) = 0
  then
    raise exception 'at least one payment method must remain available'
      using errcode = 'PT004';
  end if;
  return null;
end;
$$;

create constraint trigger payment_methods_keep_one_available
after insert or update or delete on private.payment_methods
deferrable initially deferred
for each row execute function private.payment_methods_require_available();

create constraint trigger payment_secrets_keep_one_available
after delete or update on private.payment_method_secrets
deferrable initially deferred
for each row execute function private.payment_methods_require_available();

create or replace function private.ensure_payment_methods(
  target_tenant_id uuid,
  target_location_id uuid
)
returns void
language sql
volatile
security definer
set search_path = ''
set row_security = off
as $$
  insert into private.payment_methods (
    tenant_id, location_id, method_key, enabled
  )
  select target_tenant_id, target_location_id, key, key = 'cash'
  from unnest(array[
    'cash', 'credit_card', 'debit_card', 'other_in_person', 'mercado_pago'
  ]) key
  on conflict do nothing;
$$;

-- Locks every method of the location so concurrent changes are serial.
create or replace function private.lock_payment_methods(
  target_tenant_id uuid,
  target_location_id uuid,
  target_requester_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
begin
  perform private.require_floor_plan_admin(
    target_tenant_id, target_location_id, target_requester_id
  );
  perform private.ensure_payment_methods(target_tenant_id, target_location_id);
  perform 1
  from private.payment_methods method
  where method.tenant_id = target_tenant_id
    and method.location_id = target_location_id
  order by method.method_key
  for update;
end;
$$;

create or replace function private.payment_methods_view(
  target_tenant_id uuid,
  target_location_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'method', method.method_key,
      'enabled', method.enabled,
      'available', private.payment_method_available(
        method.tenant_id, method.location_id, method.method_key,
        method.enabled, method.public_config),
      'configured', exists (
        select 1 from private.payment_method_secrets secret
        where secret.tenant_id = method.tenant_id
          and secret.location_id = method.location_id
          and secret.method_key = method.method_key),
      'publicConfig', method.public_config,
      'updatedAt', method.updated_at
    )
    order by array_position(array[
      'cash', 'credit_card', 'debit_card', 'other_in_person', 'mercado_pago'
    ], method.method_key)
  ), '[]'::jsonb)
  from private.payment_methods method
  where method.tenant_id = target_tenant_id
    and method.location_id = target_location_id;
$$;

create or replace function private.read_payment_methods(
  target_tenant_id uuid,
  target_location_id uuid,
  target_requester_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
begin
  perform private.require_floor_plan_admin(
    target_tenant_id, target_location_id, target_requester_id
  );
  perform private.ensure_payment_methods(target_tenant_id, target_location_id);
  return private.payment_methods_view(target_tenant_id, target_location_id);
end;
$$;

create or replace function private.update_payment_method(
  target_tenant_id uuid,
  target_location_id uuid,
  target_requester_id uuid,
  target_method_key text,
  target_enabled boolean,
  target_public_config jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
declare
  current_method private.payment_methods;
  next_config jsonb;
  correlation text := gen_random_uuid()::text;
begin
  perform private.lock_payment_methods(
    target_tenant_id, target_location_id, target_requester_id
  );

  select * into current_method
  from private.payment_methods method
  where method.tenant_id = target_tenant_id
    and method.location_id = target_location_id
    and method.method_key = target_method_key;
  if not found then
    raise exception 'unknown payment method' using errcode = '22023';
  end if;

  next_config := coalesce(target_public_config, current_method.public_config);
  if target_public_config is not null
    and (
      jsonb_typeof(target_public_config) <> 'object'
      or (target_public_config <> '{}'::jsonb and (
        target_method_key <> 'mercado_pago'
        or (target_public_config - 'publicKey') <> '{}'::jsonb
        or jsonb_typeof(target_public_config -> 'publicKey') <> 'string'
        or (target_public_config ->> 'publicKey') !~ '^[A-Za-z0-9_-]{8,200}$'
      ))
    )
  then
    raise exception 'invalid public configuration' using errcode = '22023';
  end if;

  if target_enabled
    and not private.payment_method_available(
      target_tenant_id, target_location_id, target_method_key,
      true, next_config
    )
  then
    raise exception 'payment provider is not configured' using errcode = 'PT003';
  end if;

  update private.payment_methods
  set enabled = target_enabled,
      public_config = next_config,
      updated_by = target_requester_id,
      updated_at = statement_timestamp()
  where tenant_id = target_tenant_id
    and location_id = target_location_id
    and method_key = target_method_key;

  -- Checked now for a precise error; the deferred trigger repeats it at commit.
  if private.payment_available_count(target_tenant_id, target_location_id) = 0 then
    raise exception 'at least one payment method must remain available'
      using errcode = 'PT004';
  end if;

  if target_enabled is distinct from current_method.enabled then
    perform private.append_audit_event(
      target_tenant_id, 'tenant_admin', target_requester_id,
      case when target_enabled then 'payment_method.enabled'
           else 'payment_method.disabled' end,
      case when target_enabled then 'Medio de pago habilitado'
           else 'Medio de pago deshabilitado' end,
      correlation, 'payment_method', current_method.id
    );
  end if;
  if next_config is distinct from current_method.public_config then
    perform private.append_audit_event(
      target_tenant_id, 'tenant_admin', target_requester_id,
      'payment_method.configured', 'Configuración pública de medio de pago modificada',
      correlation, 'payment_method', current_method.id
    );
  end if;

  return private.payment_methods_view(target_tenant_id, target_location_id);
end;
$$;

create or replace function private.store_payment_secret(
  target_tenant_id uuid,
  target_location_id uuid,
  target_requester_id uuid,
  target_method_key text,
  target_ciphertext bytea,
  target_key_version smallint
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
declare
  method_id uuid;
begin
  perform private.lock_payment_methods(
    target_tenant_id, target_location_id, target_requester_id
  );
  if target_method_key <> 'mercado_pago' then
    raise exception 'method does not accept credentials' using errcode = '22023';
  end if;

  select method.id into method_id
  from private.payment_methods method
  where method.tenant_id = target_tenant_id
    and method.location_id = target_location_id
    and method.method_key = target_method_key;

  insert into private.payment_method_secrets (
    tenant_id, location_id, method_key, ciphertext, key_version, updated_by
  ) values (
    target_tenant_id, target_location_id, target_method_key,
    target_ciphertext, target_key_version, target_requester_id
  )
  on conflict (tenant_id, location_id, method_key) do update
  set ciphertext = excluded.ciphertext,
      key_version = excluded.key_version,
      updated_by = excluded.updated_by,
      updated_at = statement_timestamp();

  perform private.append_audit_event(
    target_tenant_id, 'tenant_admin', target_requester_id,
    'payment_method.secret_stored', 'Credencial de medio de pago guardada',
    gen_random_uuid()::text, 'payment_method', method_id
  );
  return private.payment_methods_view(target_tenant_id, target_location_id);
end;
$$;

create or replace function private.clear_payment_secret(
  target_tenant_id uuid,
  target_location_id uuid,
  target_requester_id uuid,
  target_method_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
declare
  method_id uuid;
  correlation text := gen_random_uuid()::text;
  was_enabled boolean;
begin
  perform private.lock_payment_methods(
    target_tenant_id, target_location_id, target_requester_id
  );
  select method.id, method.enabled into method_id, was_enabled
  from private.payment_methods method
  where method.tenant_id = target_tenant_id
    and method.location_id = target_location_id
    and method.method_key = target_method_key;
  if method_id is null then
    raise exception 'unknown payment method' using errcode = '22023';
  end if;

  delete from private.payment_method_secrets secret
  where secret.tenant_id = target_tenant_id
    and secret.location_id = target_location_id
    and secret.method_key = target_method_key;
  if not found then
    return private.payment_methods_view(target_tenant_id, target_location_id);
  end if;

  update private.payment_methods
  set enabled = false,
      updated_by = target_requester_id,
      updated_at = statement_timestamp()
  where tenant_id = target_tenant_id
    and location_id = target_location_id
    and method_key = target_method_key;

  if private.payment_available_count(target_tenant_id, target_location_id) = 0 then
    raise exception 'at least one payment method must remain available'
      using errcode = 'PT004';
  end if;

  perform private.append_audit_event(
    target_tenant_id, 'tenant_admin', target_requester_id,
    'payment_method.secret_cleared', 'Credencial de medio de pago eliminada',
    correlation, 'payment_method', method_id
  );
  if was_enabled then
    perform private.append_audit_event(
      target_tenant_id, 'tenant_admin', target_requester_id,
      'payment_method.disabled', 'Medio de pago deshabilitado',
      correlation, 'payment_method', method_id
    );
  end if;
  return private.payment_methods_view(target_tenant_id, target_location_id);
end;
$$;

-- Used by T15: at least one available method is a publishing requirement.
create or replace function private.payment_readiness(
  target_tenant_id uuid,
  target_location_id uuid
)
returns table (available_methods integer)
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
begin
  perform private.ensure_payment_methods(target_tenant_id, target_location_id);
  return query select private.payment_available_count(
    target_tenant_id, target_location_id
  );
end;
$$;

revoke all on function private.payment_method_available(uuid, uuid, text, boolean, jsonb) from public, anon, authenticated;
revoke all on function private.payment_available_count(uuid, uuid) from public, anon, authenticated;
revoke all on function private.payment_methods_require_available() from public, anon, authenticated;
revoke all on function private.ensure_payment_methods(uuid, uuid) from public, anon, authenticated;
revoke all on function private.lock_payment_methods(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function private.payment_methods_view(uuid, uuid) from public, anon, authenticated;
revoke all on function private.read_payment_methods(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function private.update_payment_method(uuid, uuid, uuid, text, boolean, jsonb) from public, anon, authenticated;
revoke all on function private.store_payment_secret(uuid, uuid, uuid, text, bytea, smallint) from public, anon, authenticated;
revoke all on function private.clear_payment_secret(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function private.payment_readiness(uuid, uuid) from public, anon, authenticated;

grant execute on function private.read_payment_methods(uuid, uuid, uuid) to authenticator;
grant execute on function private.update_payment_method(uuid, uuid, uuid, text, boolean, jsonb) to authenticator;
grant execute on function private.store_payment_secret(uuid, uuid, uuid, text, bytea, smallint) to authenticator;
grant execute on function private.clear_payment_secret(uuid, uuid, uuid, text) to authenticator;
grant execute on function private.payment_readiness(uuid, uuid) to authenticator;

commit;
