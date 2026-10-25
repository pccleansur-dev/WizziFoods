begin;

-- Optional diner accounts with Google and per-restaurant consents (T28).
--
-- The platform knows the diner (`diner_accounts`, global, no tenant). Each restaurant
-- only knows the profile that diner created with it (`diner_profiles`, one opaque
-- `profile_id` per tenant). The only bridge between both is `diner_profile_links`,
-- which no tenant-facing function reads. The Google email lives in `diner_accounts`
-- and nowhere else. Staff (`staff_members`) and administrators (`tenant_memberships`)
-- are separate identities with their own sessions: nothing here reuses them.
--
-- Consents are append-only. Revoking appends a row; nothing is edited or deleted.
-- Orders, sessions and the ledger are not touched: sessions are related through the
-- new `diner_session_links` table.
--
-- Codes: PT281 account missing or anonymized, PT282 profile required, PT283 consent
-- text unknown or out of date, PT284 phone required (or locked while WhatsApp consent
-- is granted), PT285 nothing to revoke, PT286 command id reused with other data.

-- 1. Global accounts, sessions and login exchanges ---------------------------------------

create table private.diner_accounts (
  id uuid primary key default gen_random_uuid(),
  -- HMAC-SHA256 (with a server pepper) of the Google `sub`; never the raw value.
  google_sub_hash text unique check (google_sub_hash ~ '^[0-9a-f]{64}$'),
  email text check (email = lower(btrim(email)) and length(email) between 3 and 320),
  created_at timestamptz not null default now(),
  anonymized_at timestamptz,
  check ((anonymized_at is null) = (google_sub_hash is not null)),
  check ((anonymized_at is null) = (email is not null))
);

create table private.diner_sessions (
  token_hash bytea primary key check (length(token_hash) = 32),
  account_id uuid not null references private.diner_accounts(id) on delete restrict,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  check (expires_at > created_at)
);
create index diner_sessions_account_idx on private.diner_sessions (account_id);

-- One-time code that carries a Google login from the platform domain back to the
-- restaurant host. Bound to the tenant of that host; single use; 60 seconds.
create table private.diner_login_exchanges (
  code_hash bytea primary key check (length(code_hash) = 32),
  account_id uuid not null references private.diner_accounts(id) on delete restrict,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  redeemed_at timestamptz,
  check (expires_at > created_at)
);

-- 2. Per-restaurant profiles --------------------------------------------------------------

create table private.diner_profiles (
  id uuid not null default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  display_name text not null check (display_name = btrim(display_name) and length(display_name) between 1 and 80),
  whatsapp_phone text check (whatsapp_phone ~ '^\+[1-9][0-9]{7,14}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  anonymized_at timestamptz,
  primary key (tenant_id, id)
);

create table private.diner_profile_links (
  account_id uuid not null references private.diner_accounts(id) on delete restrict,
  tenant_id uuid not null,
  profile_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (account_id, tenant_id),
  unique (tenant_id, profile_id),
  foreign key (tenant_id, profile_id)
    references private.diner_profiles(tenant_id, id) on delete cascade
);

-- 3. Consents: versioned texts and an append-only history ---------------------------------

create table private.diner_consent_texts (
  id bigint generated always as identity primary key,
  -- null = platform default; a restaurant may publish its own newer version.
  tenant_id uuid references public.tenants(id) on delete cascade,
  kind text not null check (kind in ('whatsapp_verified', 'marketing')),
  version integer not null check (version > 0),
  body text not null check (length(body) between 20 and 4000),
  published_at timestamptz not null default now()
);
create unique index diner_consent_texts_version_idx
  on private.diner_consent_texts (
    coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), kind, version);

create table private.diner_consent_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  profile_id uuid not null,
  kind text not null check (kind in ('whatsapp_verified', 'marketing')),
  action text not null check (action in ('granted', 'revoked')),
  text_version integer not null check (text_version > 0),
  source text not null check (source in ('menu', 'profile', 'anonymization')),
  command_id uuid not null,
  occurred_at timestamptz not null default now(),
  unique (tenant_id, profile_id, command_id),
  foreign key (tenant_id, profile_id)
    references private.diner_profiles(tenant_id, id) on delete cascade
);
create index diner_consent_events_profile_idx
  on private.diner_consent_events (tenant_id, profile_id, kind, id desc);

create trigger diner_consent_events_append_only
before update or delete on private.diner_consent_events
for each row execute function private.reject_append_only_change();
create trigger diner_consent_events_no_truncate
before truncate on private.diner_consent_events
for each statement execute function private.reject_append_only_change();
create trigger diner_consent_texts_append_only
before update or delete on private.diner_consent_texts
for each row execute function private.reject_append_only_change();
create trigger diner_consent_texts_no_truncate
before truncate on private.diner_consent_texts
for each statement execute function private.reject_append_only_change();

insert into private.diner_consent_texts (tenant_id, kind, version, body) values
  (null, 'whatsapp_verified', 1,
   'Autorizo que este restaurante me contacte por WhatsApp al número que informé, solo para avisos de mis visitas y pedidos. Puedo revocarlo cuando quiera.'),
  (null, 'marketing', 1,
   'Quiero recibir novedades, promociones y premios de este restaurante. Puedo revocarlo cuando quiera.');

-- 4. Link to the open session (never a column on table_sessions) --------------------------

create table private.diner_session_links (
  tenant_id uuid not null,
  location_id uuid not null,
  session_id uuid not null,
  profile_id uuid not null,
  linked_at timestamptz not null default now(),
  primary key (tenant_id, location_id, session_id, profile_id),
  foreign key (tenant_id, location_id, session_id)
    references private.table_sessions(tenant_id, location_id, id) on delete restrict,
  foreign key (tenant_id, profile_id)
    references private.diner_profiles(tenant_id, id) on delete cascade
);
create index diner_session_links_profile_idx
  on private.diner_session_links (tenant_id, profile_id);

revoke all on table
  private.diner_accounts, private.diner_sessions, private.diner_login_exchanges,
  private.diner_profiles, private.diner_profile_links, private.diner_consent_texts,
  private.diner_consent_events, private.diner_session_links
from public, anon, authenticated, authenticator;

-- 5. Helpers (not callable by the API role) -----------------------------------------------

create function private.diner_consent_state(
  target_tenant_id uuid,
  target_profile_id uuid,
  target_kind text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select coalesce((
    select jsonb_build_object(
      'granted', event.action = 'granted',
      'textVersion', event.text_version,
      'at', event.occurred_at)
    from private.diner_consent_events event
    where event.tenant_id = target_tenant_id
      and event.profile_id = target_profile_id
      and event.kind = target_kind
    order by event.id desc
    limit 1
  ), jsonb_build_object('granted', false, 'textVersion', null, 'at', null));
$$;

create function private.diner_current_consent_texts(target_tenant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'kind', current_text.kind, 'version', current_text.version, 'body', current_text.body)
    order by current_text.kind), '[]'::jsonb)
  from (
    select distinct on (text.kind) text.kind, text.version, text.body
    from private.diner_consent_texts text
    where text.tenant_id = target_tenant_id or text.tenant_id is null
    order by text.kind, text.version desc, (text.tenant_id is null)
  ) current_text;
$$;

create function private.diner_profile_json(
  target_tenant_id uuid,
  target_profile_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select case when profile.id is null then null else jsonb_build_object(
    'profileId', profile.id,
    'displayName', profile.display_name,
    'whatsappPhone', profile.whatsapp_phone,
    'consents', jsonb_build_object(
      'whatsapp_verified', private.diner_consent_state(
        profile.tenant_id, profile.id, 'whatsapp_verified'),
      'marketing', private.diner_consent_state(
        profile.tenant_id, profile.id, 'marketing'))
  ) end
  from (select 1) one
  left join private.diner_profiles profile
    on profile.tenant_id = target_tenant_id and profile.id = target_profile_id;
$$;

-- Locks the account row (share) and refuses a missing or anonymized one. Anonymizing
-- takes the same row `for update`, so it never runs between a check and a write.
create function private.diner_account_guard(target_account_id uuid, exclusive boolean default false)
returns void
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
declare
  account private.diner_accounts%rowtype;
begin
  if exclusive then
    select * into account from private.diner_accounts where id = target_account_id for update;
  else
    select * into account from private.diner_accounts where id = target_account_id for share;
  end if;
  if not found or account.anonymized_at is not null then
    raise exception 'diner account not available' using errcode = 'PT281';
  end if;
end;
$$;

-- 6. Login --------------------------------------------------------------------------------

create function private.upsert_diner_account(target_sub_hash text, target_email text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
declare
  account_id uuid;
begin
  insert into private.diner_accounts (google_sub_hash, email)
  values (target_sub_hash, lower(btrim(target_email)))
  on conflict (google_sub_hash) do update set email = excluded.email
  returning id into account_id;
  return account_id;
end;
$$;

create function private.create_diner_login_exchange(
  target_account_id uuid,
  target_tenant_id uuid,
  target_code_hash bytea
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
begin
  perform private.diner_account_guard(target_account_id);
  insert into private.diner_login_exchanges (code_hash, account_id, tenant_id, expires_at)
  values (target_code_hash, target_account_id, target_tenant_id, now() + interval '60 seconds');
end;
$$;

-- Returns the account id, or null for any unknown, expired, reused or foreign code.
create function private.redeem_diner_login(
  target_tenant_id uuid,
  target_code_hash bytea,
  target_session_hash bytea
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
declare
  exchange private.diner_login_exchanges%rowtype;
  account private.diner_accounts%rowtype;
begin
  select * into exchange
  from private.diner_login_exchanges
  where code_hash = target_code_hash and tenant_id = target_tenant_id
  for update;
  if not found or exchange.redeemed_at is not null or exchange.expires_at <= now() then
    return null;
  end if;
  select * into account from private.diner_accounts where id = exchange.account_id for share;
  if not found or account.anonymized_at is not null then
    return null;
  end if;
  update private.diner_login_exchanges set redeemed_at = now() where code_hash = target_code_hash;
  insert into private.diner_sessions (token_hash, account_id, tenant_id, expires_at)
  values (target_session_hash, exchange.account_id, target_tenant_id, now() + interval '30 days');
  return exchange.account_id;
end;
$$;

create function private.resolve_diner_session(target_tenant_id uuid, target_token_hash bytea)
returns uuid
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select session.account_id
  from private.diner_sessions session
  join private.diner_accounts account on account.id = session.account_id
  where session.token_hash = target_token_hash
    and session.tenant_id = target_tenant_id
    and session.revoked_at is null
    and session.expires_at > now()
    and account.anonymized_at is null;
$$;

create function private.revoke_diner_session(target_tenant_id uuid, target_token_hash bytea)
returns void
language sql
volatile
security definer
set search_path = ''
set row_security = off
as $$
  update private.diner_sessions
  set revoked_at = now()
  where token_hash = target_token_hash
    and tenant_id = target_tenant_id
    and revoked_at is null;
$$;

-- 7. Profile ------------------------------------------------------------------------------

create function private.diner_profile_id_of(target_tenant_id uuid, target_account_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select link.profile_id from private.diner_profile_links link
  where link.account_id = target_account_id and link.tenant_id = target_tenant_id;
$$;

create function private.get_diner_profile(target_tenant_id uuid, target_account_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set row_security = off
as $$
begin
  return jsonb_build_object(
    'profile', private.diner_profile_json(
      target_tenant_id, private.diner_profile_id_of(target_tenant_id, target_account_id)),
    'texts', private.diner_current_consent_texts(target_tenant_id));
end;
$$;

create function private.save_diner_profile(
  target_tenant_id uuid,
  target_account_id uuid,
  target_display_name text,
  target_phone text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
declare
  profile_id uuid;
  current_phone text;
begin
  perform private.diner_account_guard(target_account_id, true);
  profile_id := private.diner_profile_id_of(target_tenant_id, target_account_id);
  if profile_id is null then
    insert into private.diner_profiles (tenant_id, display_name, whatsapp_phone)
    values (target_tenant_id, target_display_name, target_phone)
    returning id into profile_id;
    insert into private.diner_profile_links (account_id, tenant_id, profile_id)
    values (target_account_id, target_tenant_id, profile_id);
  else
    select whatsapp_phone into current_phone from private.diner_profiles
    where tenant_id = target_tenant_id and id = profile_id;
    if current_phone is distinct from target_phone
      and (private.diner_consent_state(target_tenant_id, profile_id, 'whatsapp_verified') ->> 'granted')::boolean
    then
      raise exception 'revoke the WhatsApp consent before changing the phone' using errcode = 'PT284';
    end if;
    update private.diner_profiles
    set display_name = target_display_name, whatsapp_phone = target_phone, updated_at = now()
    where tenant_id = target_tenant_id and id = profile_id;
  end if;
  return private.get_diner_profile(target_tenant_id, target_account_id);
end;
$$;

-- 8. Consents -----------------------------------------------------------------------------

create function private.record_diner_consent(
  target_tenant_id uuid,
  target_account_id uuid,
  target_command_id uuid,
  target_kind text,
  target_action text,
  target_text_version integer,
  target_source text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
declare
  own_profile uuid;
  existing private.diner_consent_events%rowtype;
  current_state jsonb;
  current_version integer;
begin
  perform private.diner_account_guard(target_account_id);
  own_profile := private.diner_profile_id_of(target_tenant_id, target_account_id);
  if own_profile is null then
    raise exception 'create the profile first' using errcode = 'PT282';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended('diner-consent:' || own_profile::text || ':' || target_kind, 0));

  select * into existing from private.diner_consent_events
  where tenant_id = target_tenant_id and profile_id = own_profile
    and command_id = target_command_id;
  if found then
    if existing.kind <> target_kind or existing.action <> target_action
      or existing.text_version <> target_text_version
    then
      raise exception 'command id reused with other data' using errcode = 'PT286';
    end if;
    return private.get_diner_profile(target_tenant_id, target_account_id);
  end if;

  current_state := private.diner_consent_state(target_tenant_id, own_profile, target_kind);
  if target_action = 'granted' then
    select (entry ->> 'version')::integer into current_version
    from jsonb_array_elements(private.diner_current_consent_texts(target_tenant_id)) entry
    where entry ->> 'kind' = target_kind;
    if current_version is distinct from target_text_version then
      raise exception 'consent text out of date' using errcode = 'PT283';
    end if;
    if target_kind = 'whatsapp_verified' and (
      select whatsapp_phone from private.diner_profiles
      where tenant_id = target_tenant_id and id = own_profile) is null
    then
      raise exception 'phone required for WhatsApp consent' using errcode = 'PT284';
    end if;
    if (current_state ->> 'granted')::boolean
      and (current_state ->> 'textVersion')::integer = target_text_version
    then
      return private.get_diner_profile(target_tenant_id, target_account_id);
    end if;
  else
    if not (current_state ->> 'granted')::boolean then
      raise exception 'nothing to revoke' using errcode = 'PT285';
    end if;
    -- A revocation records the version that was granted.
    target_text_version := (current_state ->> 'textVersion')::integer;
  end if;

  insert into private.diner_consent_events (
    tenant_id, profile_id, kind, action, text_version, source, command_id
  ) values (
    target_tenant_id, own_profile, target_kind, target_action, target_text_version,
    target_source, target_command_id);
  return private.get_diner_profile(target_tenant_id, target_account_id);
end;
$$;

-- 9. Link to the open session -------------------------------------------------------------

-- The diner links to the SESSION the QR resolves to right now (group or loose table),
-- never to a table. Takes the shared location lock so a join or separation in flight
-- finishes first. If no session is open yet nothing is linked.
create function private.link_diner_to_session(
  target_tenant_id uuid,
  target_location_id uuid,
  target_account_id uuid,
  target_token text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
declare
  profile_id uuid;
  session_id uuid;
begin
  perform pg_advisory_xact_lock_shared(
    private.table_groups_lock_key(target_tenant_id, target_location_id));
  perform private.diner_account_guard(target_account_id);
  profile_id := private.diner_profile_id_of(target_tenant_id, target_account_id);
  if profile_id is null then
    raise exception 'create the profile first' using errcode = 'PT282';
  end if;
  session_id := private.diner_split_session(
    target_tenant_id, target_location_id, target_token);
  if session_id is null then
    return jsonb_build_object('linked', false);
  end if;
  insert into private.diner_session_links (tenant_id, location_id, session_id, profile_id)
  values (target_tenant_id, target_location_id, session_id, profile_id)
  on conflict do nothing;
  return jsonb_build_object('linked', true);
end;
$$;

-- 10. What a restaurant may see -----------------------------------------------------------

-- Profiles of THIS tenant only. No account id, no email, nothing from other tenants.
-- The phone is shown only while the WhatsApp consent is granted.
create function private.list_tenant_diner_profiles(target_tenant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'profileId', profile.id,
    'displayName', profile.display_name,
    'createdAt', profile.created_at,
    'anonymized', profile.anonymized_at is not null,
    'whatsappPhone', case
      when (private.diner_consent_state(profile.tenant_id, profile.id, 'whatsapp_verified') ->> 'granted')::boolean
      then profile.whatsapp_phone end,
    'whatsappConsent', (private.diner_consent_state(
      profile.tenant_id, profile.id, 'whatsapp_verified') ->> 'granted')::boolean,
    'marketingConsent', (private.diner_consent_state(
      profile.tenant_id, profile.id, 'marketing') ->> 'granted')::boolean
  ) order by profile.created_at, profile.id), '[]'::jsonb)
  from private.diner_profiles profile
  where profile.tenant_id = target_tenant_id;
$$;

-- 11. Export and logical anonymization of the diner's own data ----------------------------

create function private.export_diner_data(target_account_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set row_security = off
as $$
declare
  account private.diner_accounts%rowtype;
begin
  select * into account from private.diner_accounts where id = target_account_id;
  if not found or account.anonymized_at is not null then
    raise exception 'diner account not available' using errcode = 'PT281';
  end if;
  return jsonb_build_object(
    'account', jsonb_build_object('email', account.email, 'createdAt', account.created_at),
    'restaurants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'restaurant', tenant.name,
        'slug', tenant.slug,
        'displayName', profile.display_name,
        'whatsappPhone', profile.whatsapp_phone,
        'createdAt', profile.created_at,
        'consents', coalesce((
          select jsonb_agg(jsonb_build_object(
            'kind', event.kind, 'action', event.action, 'textVersion', event.text_version,
            'source', event.source, 'at', event.occurred_at) order by event.id)
          from private.diner_consent_events event
          where event.tenant_id = profile.tenant_id and event.profile_id = profile.id), '[]'::jsonb),
        'sessions', coalesce((
          select jsonb_agg(jsonb_build_object(
            'sessionId', link.session_id, 'linkedAt', link.linked_at) order by link.linked_at)
          from private.diner_session_links link
          where link.tenant_id = profile.tenant_id and link.profile_id = profile.id), '[]'::jsonb)
      ) order by profile.created_at)
      from private.diner_profile_links link
      join private.diner_profiles profile
        on profile.tenant_id = link.tenant_id and profile.id = link.profile_id
      join public.tenants tenant on tenant.id = profile.tenant_id
      where link.account_id = target_account_id), '[]'::jsonb));
end;
$$;

-- The account keeps no personal data; visits, accounts and orders keep their references
-- (profile ids and session links stay). Consents granted are revoked by appending rows.
create function private.anonymize_diner_account(target_account_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
declare
  account private.diner_accounts%rowtype;
  profile record;
  consent_kind text;
  state jsonb;
begin
  select * into account from private.diner_accounts where id = target_account_id for update;
  if not found then
    raise exception 'diner account not available' using errcode = 'PT281';
  end if;
  if account.anonymized_at is not null then
    return jsonb_build_object('anonymizedAt', account.anonymized_at);
  end if;

  for profile in
    select link.tenant_id, link.profile_id from private.diner_profile_links link
    where link.account_id = target_account_id
  loop
    foreach consent_kind in array array['whatsapp_verified', 'marketing'] loop
      state := private.diner_consent_state(profile.tenant_id, profile.profile_id, consent_kind);
      if (state ->> 'granted')::boolean then
        insert into private.diner_consent_events (
          tenant_id, profile_id, kind, action, text_version, source, command_id
        ) values (
          profile.tenant_id, profile.profile_id, consent_kind, 'revoked',
          (state ->> 'textVersion')::integer, 'anonymization', gen_random_uuid());
      end if;
    end loop;
    update private.diner_profiles
    set display_name = 'Comensal anonimizado', whatsapp_phone = null,
      anonymized_at = now(), updated_at = now()
    where tenant_id = profile.tenant_id and id = profile.profile_id;
  end loop;

  update private.diner_sessions set revoked_at = now()
  where account_id = target_account_id and revoked_at is null;
  delete from private.diner_login_exchanges where account_id = target_account_id;
  update private.diner_accounts
  set google_sub_hash = null, email = null, anonymized_at = now()
  where id = target_account_id
  returning anonymized_at into account.anonymized_at;
  return jsonb_build_object('anonymizedAt', account.anonymized_at);
end;
$$;

revoke all on function
  private.diner_consent_state(uuid, uuid, text),
  private.diner_current_consent_texts(uuid),
  private.diner_profile_json(uuid, uuid),
  private.diner_account_guard(uuid, boolean),
  private.diner_profile_id_of(uuid, uuid),
  private.upsert_diner_account(text, text),
  private.create_diner_login_exchange(uuid, uuid, bytea),
  private.redeem_diner_login(uuid, bytea, bytea),
  private.resolve_diner_session(uuid, bytea),
  private.revoke_diner_session(uuid, bytea),
  private.get_diner_profile(uuid, uuid),
  private.save_diner_profile(uuid, uuid, text, text),
  private.record_diner_consent(uuid, uuid, uuid, text, text, integer, text),
  private.link_diner_to_session(uuid, uuid, uuid, text),
  private.list_tenant_diner_profiles(uuid),
  private.export_diner_data(uuid),
  private.anonymize_diner_account(uuid)
from public, anon, authenticated, authenticator;
grant execute on function
  private.upsert_diner_account(text, text),
  private.create_diner_login_exchange(uuid, uuid, bytea),
  private.redeem_diner_login(uuid, bytea, bytea),
  private.resolve_diner_session(uuid, bytea),
  private.revoke_diner_session(uuid, bytea),
  private.get_diner_profile(uuid, uuid),
  private.save_diner_profile(uuid, uuid, text, text),
  private.record_diner_consent(uuid, uuid, uuid, text, text, integer, text),
  private.link_diner_to_session(uuid, uuid, uuid, text),
  private.list_tenant_diner_profiles(uuid),
  private.export_diner_data(uuid),
  private.anonymize_diner_account(uuid)
to authenticator;

commit;
