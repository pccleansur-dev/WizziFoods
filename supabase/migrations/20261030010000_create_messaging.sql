begin;

-- T30: WhatsApp connection per location, approved templates, permanent automations,
-- one-off events that need confirmation, an outbox and an append-only history.
--
-- One rule governs everything: a message leaves ONLY if private.messaging_send_decision
-- says so, and that function blocks when anything is missing, unknown or failing.
-- Nothing here is read by the menu, the login or an order: a missing configuration
-- simply means no messages. Real sending also stays off per connection
-- (sending_enabled = false) until the legal and commercial review of Checkpoint 9.
--
-- Error codes: PT293 not connected, PT294 number connected elsewhere, PT295 template
-- unknown or not approved, PT296 automation unknown or invalid transition, PT297 invalid
-- data, PT298 one-off event unknown or not awaiting confirmation.

-- 0. A consent origin of its own for "BAJA" -------------------------------------------------

alter table private.diner_consent_events
  drop constraint diner_consent_events_source_check;
alter table private.diner_consent_events
  add constraint diner_consent_events_source_check
  check (source in ('menu', 'profile', 'anonymization', 'whatsapp_optout'));

-- 1. Connection (one per location; credentials sealed by the API) --------------------------

create table private.whatsapp_connections (
  tenant_id uuid not null,
  location_id uuid not null,
  phone_number_id text not null check (phone_number_id ~ '^[0-9]{5,30}$'),
  waba_id text not null check (waba_id ~ '^[0-9]{5,30}$'),
  display_phone text check (display_phone ~ '^\+[1-9][0-9]{7,14}$'),
  -- Real sending stays off until someone switches it on, on purpose.
  sending_enabled boolean not null default false,
  ciphertext bytea not null check (octet_length(ciphertext) > 0),
  key_version smallint not null check (key_version > 0),
  connected_by uuid not null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, location_id),
  unique (phone_number_id),
  foreign key (tenant_id, location_id)
    references public.locations(tenant_id, id) on delete cascade
);

-- 2. Templates ------------------------------------------------------------------------------

create table private.whatsapp_templates (
  id uuid not null default gen_random_uuid(),
  tenant_id uuid not null,
  location_id uuid not null,
  name text not null check (name ~ '^[a-z0-9_]{1,100}$'),
  language text not null check (language ~ '^[a-z]{2}(_[A-Z]{2})?$'),
  category text not null check (category in ('operational', 'promotional')),
  body text not null check (length(body) between 1 and 1024),
  approval_status text not null default 'pending'
    check (approval_status in ('pending', 'approved', 'rejected')),
  estimated_cost_cents numeric(8, 3) not null default 0 check (estimated_cost_cents >= 0),
  synced_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, location_id, name, language),
  foreign key (tenant_id, location_id)
    references public.locations(tenant_id, id) on delete cascade
);

-- 3. Permanent automations (approved once) --------------------------------------------------

create table private.messaging_automations (
  id uuid not null default gen_random_uuid(),
  tenant_id uuid not null,
  location_id uuid not null,
  kind text not null
    check (kind in ('reward_earned', 'reward_expiring', 'birthday', 'inactivity')),
  template_id uuid,
  status text not null default 'pending_approval'
    check (status in ('pending_approval', 'approved', 'paused')),
  approved_by uuid,
  approved_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, location_id, kind),
  foreign key (tenant_id, location_id)
    references public.locations(tenant_id, id) on delete cascade,
  foreign key (tenant_id, template_id)
    references private.whatsapp_templates(tenant_id, id) on delete restrict,
  check (status = 'pending_approval' or (template_id is not null and approved_at is not null))
);

-- 4. Outbox ---------------------------------------------------------------------------------

create table private.messaging_outbox (
  id uuid not null default gen_random_uuid(),
  tenant_id uuid not null,
  location_id uuid not null,
  profile_id uuid not null,
  origin text not null check (origin in ('automation', 'one_off')),
  automation_id uuid,
  -- A one-off event is confirmed as a whole; its id is the command that created it.
  batch_id uuid,
  -- One message per person and event: the idempotency key.
  event_key text not null check (length(event_key) between 1 and 200),
  template_id uuid not null,
  template_name text not null,
  template_language text not null,
  category text not null check (category in ('operational', 'promotional')),
  estimated_cost_cents numeric(8, 3) not null default 0,
  variables jsonb not null default '[]'::jsonb
    check (jsonb_typeof(variables) = 'array' and jsonb_array_length(variables) <= 10),
  status text not null default 'queued' check (status in (
    'awaiting_confirmation', 'queued', 'sending', 'sent', 'delivered',
    'failed', 'blocked', 'cancelled')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 10),
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  sent_at timestamptz,
  provider_message_id text check (length(provider_message_id) between 1 and 200),
  last_error text check (length(last_error) <= 300),
  confirmed_by uuid,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, profile_id, event_key),
  foreign key (tenant_id, location_id)
    references public.locations(tenant_id, id) on delete cascade,
  foreign key (tenant_id, profile_id)
    references private.diner_profiles(tenant_id, id) on delete cascade,
  check ((origin = 'automation') = (automation_id is not null)),
  check ((origin = 'one_off') = (batch_id is not null))
);
create index messaging_outbox_due_idx
  on private.messaging_outbox (next_attempt_at) where status = 'queued';
create index messaging_outbox_sending_idx
  on private.messaging_outbox (locked_until) where status = 'sending';
create index messaging_outbox_profile_idx
  on private.messaging_outbox (tenant_id, profile_id, category, sent_at);
create index messaging_outbox_batch_idx
  on private.messaging_outbox (tenant_id, batch_id) where batch_id is not null;
create unique index messaging_outbox_provider_message_idx
  on private.messaging_outbox (provider_message_id) where provider_message_id is not null;

create trigger messaging_outbox_no_delete
before delete on private.messaging_outbox
for each row execute function private.reject_append_only_change();
create trigger messaging_outbox_no_truncate
before truncate on private.messaging_outbox
for each statement execute function private.reject_append_only_change();

-- 5. History: append-only -------------------------------------------------------------------

create table private.messaging_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  location_id uuid not null,
  outbox_id uuid,
  profile_id uuid not null,
  kind text not null check (kind in (
    'queued', 'sent', 'delivered', 'read', 'failed', 'blocked', 'deferred',
    'retry_scheduled', 'cancelled', 'opt_out')),
  reason text check (length(reason) <= 300),
  provider_message_id text,
  occurred_at timestamptz not null default now(),
  foreign key (tenant_id, location_id)
    references public.locations(tenant_id, id) on delete cascade,
  foreign key (tenant_id, outbox_id)
    references private.messaging_outbox(tenant_id, id) on delete restrict
);
create index messaging_events_tenant_idx
  on private.messaging_events (tenant_id, location_id, id desc);

create trigger messaging_events_append_only
before update or delete on private.messaging_events
for each row execute function private.reject_append_only_change();
create trigger messaging_events_no_truncate
before truncate on private.messaging_events
for each statement execute function private.reject_append_only_change();

-- 6. Webhook notifications seen once --------------------------------------------------------

create table private.messaging_webhook_events (
  id bigint generated always as identity primary key,
  event_key text not null unique check (length(event_key) between 1 and 300),
  tenant_id uuid,
  location_id uuid,
  topic text not null check (length(topic) between 1 and 60),
  attempts integer not null default 1,
  outcome text check (outcome in (
    'applied', 'unchanged', 'ignored', 'unknown_number', 'unknown_message', 'failed')),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  check ((outcome is null) = (processed_at is null)),
  foreign key (tenant_id, location_id)
    references public.locations(tenant_id, id) on delete cascade
);

revoke all on table
  private.whatsapp_connections, private.whatsapp_templates, private.messaging_automations,
  private.messaging_outbox, private.messaging_events, private.messaging_webhook_events
from public, anon, authenticated, authenticator;
revoke all on sequence
  private.messaging_events_id_seq, private.messaging_webhook_events_id_seq
from public, anon, authenticated, authenticator;

-- 7. The sending policy ---------------------------------------------------------------------

-- The last time the person did anything with this restaurant: a visit, a link to a
-- session, a consent granted or a profile change. Twelve months of nothing stops
-- promotional messages until they renew their consent (which is itself activity).
create function private.messaging_last_activity(
  target_tenant_id uuid,
  target_profile_id uuid
)
returns timestamptz
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select greatest(
    profile.created_at,
    profile.updated_at,
    (select max(visit.created_at) from private.loyalty_visits visit
     where visit.tenant_id = profile.tenant_id and visit.profile_id = profile.id),
    (select max(link.linked_at) from private.diner_session_links link
     where link.tenant_id = profile.tenant_id and link.profile_id = profile.id),
    (select max(event.occurred_at) from private.diner_consent_events event
     where event.tenant_id = profile.tenant_id and event.profile_id = profile.id
       and event.action = 'granted'))
  from private.diner_profiles profile
  where profile.tenant_id = target_tenant_id and profile.id = target_profile_id;
$$;

-- Consent in force, always read from the append-only history, never from the phone.
create function private.messaging_consent_ok(
  target_tenant_id uuid,
  target_profile_id uuid,
  target_category text
)
returns boolean
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select coalesce(
    (private.diner_consent_state(
      target_tenant_id, target_profile_id, 'whatsapp_verified') ->> 'granted')::boolean
    and (target_category = 'operational' or coalesce(
      (private.diner_consent_state(
        target_tenant_id, target_profile_id, 'marketing') ->> 'granted')::boolean, false)),
    false);
$$;

-- The single decision. Returns {action: send|block|defer, reason, retryAt?}. Anything
-- unexpected becomes a block: if in doubt, the message does not go out.
create function private.messaging_send_decision(
  target_tenant_id uuid,
  target_location_id uuid,
  target_outbox_id uuid,
  target_at timestamptz
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
declare
  item private.messaging_outbox%rowtype;
  profile private.diner_profiles%rowtype;
  connection private.whatsapp_connections%rowtype;
  template private.whatsapp_templates%rowtype;
  automation private.messaging_automations%rowtype;
  zone text;
  local_stamp timestamp;
  local_time time;
begin
  select * into item from private.messaging_outbox candidate
  where candidate.tenant_id = target_tenant_id and candidate.id = target_outbox_id
    and candidate.location_id = target_location_id;
  if not found then
    return jsonb_build_object('action', 'block', 'reason', 'unknown_message');
  end if;
  select * into profile from private.diner_profiles candidate
  where candidate.tenant_id = target_tenant_id and candidate.id = item.profile_id;
  if not found or profile.anonymized_at is not null then
    return jsonb_build_object('action', 'block', 'reason', 'anonymized_profile');
  end if;
  if profile.whatsapp_phone is null then
    return jsonb_build_object('action', 'block', 'reason', 'no_phone');
  end if;
  select * into connection from private.whatsapp_connections candidate
  where candidate.tenant_id = target_tenant_id and candidate.location_id = target_location_id;
  if not found then
    return jsonb_build_object('action', 'block', 'reason', 'not_connected');
  end if;
  if not connection.sending_enabled then
    return jsonb_build_object('action', 'block', 'reason', 'sending_disabled');
  end if;
  select * into template from private.whatsapp_templates candidate
  where candidate.tenant_id = target_tenant_id and candidate.id = item.template_id
    and candidate.location_id = target_location_id;
  if not found or template.approval_status <> 'approved' then
    return jsonb_build_object('action', 'block', 'reason', 'template_not_approved');
  end if;
  if template.category <> item.category then
    return jsonb_build_object('action', 'block', 'reason', 'template_changed');
  end if;
  if item.origin = 'automation' then
    select * into automation from private.messaging_automations candidate
    where candidate.tenant_id = target_tenant_id and candidate.id = item.automation_id;
    if not found or automation.status <> 'approved'
      or automation.template_id is distinct from item.template_id
    then
      return jsonb_build_object('action', 'block', 'reason', 'automation_not_approved');
    end if;
  elsif item.confirmed_at is null then
    return jsonb_build_object('action', 'block', 'reason', 'not_confirmed');
  end if;

  if not private.messaging_consent_ok(target_tenant_id, item.profile_id, item.category) then
    return jsonb_build_object('action', 'block', 'reason',
      case item.category when 'promotional' then 'marketing_consent_missing'
        else 'whatsapp_consent_missing' end);
  end if;

  -- Operational notices go out right away and spend no promotional allowance.
  if item.category = 'operational' then
    return jsonb_build_object('action', 'send', 'reason', 'ok');
  end if;

  if target_at - private.messaging_last_activity(target_tenant_id, item.profile_id)
    > interval '12 months'
  then
    return jsonb_build_object('action', 'block', 'reason', 'inactive_12_months');
  end if;
  if (select count(*) from private.messaging_outbox sent
      where sent.tenant_id = target_tenant_id and sent.profile_id = item.profile_id
        and sent.category = 'promotional' and sent.id <> item.id
        and sent.status in ('sending', 'sent', 'delivered')
        and sent.sent_at > target_at - interval '7 days') >= 2
  then
    return jsonb_build_object('action', 'block', 'reason', 'weekly_cap');
  end if;
  if (select count(*) from private.messaging_outbox sent
      where sent.tenant_id = target_tenant_id and sent.profile_id = item.profile_id
        and sent.category = 'promotional' and sent.id <> item.id
        and sent.status in ('sending', 'sent', 'delivered')
        and sent.sent_at > target_at - interval '30 days') >= 8
  then
    return jsonb_build_object('action', 'block', 'reason', 'monthly_cap');
  end if;

  select location.timezone into zone from public.locations location
  where location.id = target_location_id and location.tenant_id = target_tenant_id;
  if zone is null then
    return jsonb_build_object('action', 'block', 'reason', 'unknown_timezone');
  end if;
  local_stamp := target_at at time zone zone;
  local_time := local_stamp::time;
  if local_time < time '10:00' or local_time >= time '20:00' then
    return jsonb_build_object('action', 'defer', 'reason', 'outside_hours', 'retryAt',
      ((case when local_time < time '10:00' then local_stamp::date
         else local_stamp::date + 1 end) + time '10:00') at time zone zone);
  end if;
  return jsonb_build_object('action', 'send', 'reason', 'ok');
exception when others then
  return jsonb_build_object('action', 'block', 'reason', 'policy_error');
end;
$$;

create function private.log_messaging_event(
  target_item private.messaging_outbox,
  target_kind text,
  target_reason text
)
returns void
language sql
volatile
security definer
set search_path = ''
set row_security = off
as $$
  insert into private.messaging_events (
    tenant_id, location_id, outbox_id, profile_id, kind, reason, provider_message_id
  ) values (
    target_item.tenant_id, target_item.location_id, target_item.id, target_item.profile_id,
    target_kind, left(target_reason, 300), target_item.provider_message_id);
$$;

-- 8. Queue: claim, begin, finish ------------------------------------------------------------

-- Hands out due messages. A claimed message is invisible to other workers until the
-- lease ends. A message found "sending" with an expired lease is NOT sent again: nobody
-- knows whether it left, so it is closed as failed instead.
create function private.claim_messaging_outbox(
  target_limit integer,
  target_lease_seconds integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
declare
  lost private.messaging_outbox%rowtype;
  claimed jsonb;
begin
  if target_limit not between 1 and 100 or target_lease_seconds not between 5 and 3600 then
    raise exception 'invalid claim' using errcode = 'PT297';
  end if;
  for lost in
    select * from private.messaging_outbox stale
    where stale.status = 'sending' and stale.locked_until < now()
    order by stale.locked_until
    limit 100
    for update skip locked
  loop
    update private.messaging_outbox set status = 'failed', last_error = 'lost_lease',
      locked_until = null, updated_at = now()
    where tenant_id = lost.tenant_id and id = lost.id;
    perform private.log_messaging_event(lost, 'failed', 'lost_lease');
  end loop;
  with due as (
    select candidate.tenant_id, candidate.id
    from private.messaging_outbox candidate
    where candidate.status = 'queued' and candidate.next_attempt_at <= now()
      and (candidate.locked_until is null or candidate.locked_until < now())
    order by candidate.next_attempt_at, candidate.id
    limit target_limit
    for update skip locked
  ), taken as (
    update private.messaging_outbox item
    set locked_until = now() + make_interval(secs => target_lease_seconds)
    from due
    where item.tenant_id = due.tenant_id and item.id = due.id
    returning item.tenant_id, item.location_id, item.id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', taken.id, 'tenantId', taken.tenant_id, 'locationId', taken.location_id)), '[]')
  into claimed from taken;
  return claimed;
end;
$$;

-- The moment of truth. Serialized per person so the allowances cannot be raced, and
-- only a "queued" message can start: a second worker on the same message skips.
create function private.begin_messaging_send(
  target_tenant_id uuid,
  target_location_id uuid,
  target_outbox_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
declare
  person uuid;
  item private.messaging_outbox%rowtype;
  decision jsonb;
  phone text;
  phone_number text;
begin
  select candidate.profile_id into person from private.messaging_outbox candidate
  where candidate.tenant_id = target_tenant_id and candidate.id = target_outbox_id
    and candidate.location_id = target_location_id;
  if person is null then
    return jsonb_build_object('action', 'skip');
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended('messaging:' || target_tenant_id::text || person::text, 0));
  select * into item from private.messaging_outbox candidate
  where candidate.tenant_id = target_tenant_id and candidate.id = target_outbox_id
    and candidate.status = 'queued' and candidate.next_attempt_at <= now()
  for update;
  if not found then
    return jsonb_build_object('action', 'skip');
  end if;
  decision := private.messaging_send_decision(
    target_tenant_id, target_location_id, target_outbox_id, now());
  if decision ->> 'action' = 'block' then
    update private.messaging_outbox set status = 'blocked', last_error = decision ->> 'reason',
      locked_until = null, updated_at = now()
    where tenant_id = target_tenant_id and id = target_outbox_id;
    perform private.log_messaging_event(item, 'blocked', decision ->> 'reason');
    return jsonb_build_object('action', 'blocked', 'reason', decision ->> 'reason');
  elsif decision ->> 'action' = 'defer' then
    update private.messaging_outbox set locked_until = null, updated_at = now(),
      next_attempt_at = (decision ->> 'retryAt')::timestamptz
    where tenant_id = target_tenant_id and id = target_outbox_id;
    perform private.log_messaging_event(item, 'deferred', decision ->> 'reason');
    return jsonb_build_object('action', 'deferred', 'reason', decision ->> 'reason');
  end if;
  select profile.whatsapp_phone into phone from private.diner_profiles profile
  where profile.tenant_id = target_tenant_id and profile.id = item.profile_id;
  select connection.phone_number_id into phone_number from private.whatsapp_connections connection
  where connection.tenant_id = target_tenant_id and connection.location_id = target_location_id;
  update private.messaging_outbox
  set status = 'sending', attempts = item.attempts + 1, sent_at = now(),
      locked_until = now() + interval '2 minutes', updated_at = now()
  where tenant_id = target_tenant_id and id = target_outbox_id;
  return jsonb_build_object(
    'action', 'send', 'phone', phone, 'phoneNumberId', phone_number,
    'templateName', item.template_name, 'language', item.template_language,
    'category', item.category, 'variables', item.variables,
    'attempt', item.attempts + 1);
end;
$$;

create function private.finish_messaging_send(
  target_tenant_id uuid,
  target_location_id uuid,
  target_outbox_id uuid,
  target_outcome text,
  target_provider_message_id text,
  target_error text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
declare
  item private.messaging_outbox%rowtype;
  backoff interval;
begin
  if target_outcome not in ('sent', 'transient_failure', 'permanent_failure') then
    raise exception 'invalid outcome' using errcode = 'PT297';
  end if;
  select * into item from private.messaging_outbox candidate
  where candidate.tenant_id = target_tenant_id and candidate.id = target_outbox_id
    and candidate.location_id = target_location_id and candidate.status = 'sending'
  for update;
  if not found then
    return jsonb_build_object('applied', false);
  end if;
  if target_outcome = 'sent' then
    update private.messaging_outbox set status = 'sent', locked_until = null,
      provider_message_id = target_provider_message_id, last_error = null, updated_at = now()
    where tenant_id = target_tenant_id and id = target_outbox_id
    returning * into item;
    perform private.log_messaging_event(item, 'sent', null);
    return jsonb_build_object('applied', true, 'status', 'sent');
  end if;
  if target_outcome = 'transient_failure' and item.attempts < item.max_attempts then
    -- 30 s, 1 min, 2 min, 4 min... up to an hour. The attempt was spent; the
    -- allowance was not (a message that did not leave does not count).
    backoff := least(interval '1 hour',
      interval '30 seconds' * power(2, greatest(item.attempts - 1, 0)));
    update private.messaging_outbox set status = 'queued', sent_at = null, locked_until = null,
      last_error = left(target_error, 300), next_attempt_at = now() + backoff,
      updated_at = now()
    where tenant_id = target_tenant_id and id = target_outbox_id;
    perform private.log_messaging_event(item, 'retry_scheduled', target_error);
    return jsonb_build_object('applied', true, 'status', 'queued');
  end if;
  update private.messaging_outbox set status = 'failed', sent_at = null, locked_until = null,
    last_error = left(case when target_outcome = 'transient_failure'
      then 'retries_exhausted: ' || coalesce(target_error, '') else target_error end, 300),
    updated_at = now()
  where tenant_id = target_tenant_id and id = target_outbox_id
  returning * into item;
  perform private.log_messaging_event(item, 'failed', item.last_error);
  return jsonb_build_object('applied', true, 'status', 'failed');
end;
$$;

-- Credentials for the worker and the API (sealed; opened only in their memory).
create function private.read_whatsapp_credentials(
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
  select jsonb_build_object(
    'ciphertext', encode(connection.ciphertext, 'base64'),
    'keyVersion', connection.key_version,
    'phoneNumberId', connection.phone_number_id,
    'wabaId', connection.waba_id)
  from private.whatsapp_connections connection
  where connection.tenant_id = target_tenant_id
    and connection.location_id = target_location_id;
$$;

-- 9. Events that create messages ------------------------------------------------------------

-- Puts one message in the queue for an approved automation. Silent when anything is
-- missing: no approval, no template, no number, no phone, no consent. Safe to call twice.
create function private.enqueue_messaging_event(
  target_tenant_id uuid,
  target_location_id uuid,
  target_profile_id uuid,
  target_kind text,
  target_event_key text,
  target_variables jsonb
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
declare
  automation private.messaging_automations%rowtype;
  template private.whatsapp_templates%rowtype;
  item private.messaging_outbox%rowtype;
begin
  select * into automation from private.messaging_automations candidate
  where candidate.tenant_id = target_tenant_id and candidate.location_id = target_location_id
    and candidate.kind = target_kind and candidate.status = 'approved';
  if not found then return false; end if;
  select * into template from private.whatsapp_templates candidate
  where candidate.tenant_id = target_tenant_id and candidate.id = automation.template_id
    and candidate.approval_status = 'approved';
  if not found then return false; end if;
  if not exists (
    select 1 from private.whatsapp_connections connection
    where connection.tenant_id = target_tenant_id and connection.location_id = target_location_id)
  then return false; end if;
  if not exists (
    select 1 from private.diner_profiles profile
    where profile.tenant_id = target_tenant_id and profile.id = target_profile_id
      and profile.anonymized_at is null and profile.whatsapp_phone is not null)
    or not private.messaging_consent_ok(target_tenant_id, target_profile_id, template.category)
  then return false; end if;
  insert into private.messaging_outbox (
    tenant_id, location_id, profile_id, origin, automation_id, event_key, template_id,
    template_name, template_language, category, estimated_cost_cents, variables
  ) values (
    target_tenant_id, target_location_id, target_profile_id, 'automation', automation.id,
    target_event_key, template.id, template.name, template.language, template.category,
    template.estimated_cost_cents, target_variables)
  on conflict (tenant_id, profile_id, event_key) do nothing
  returning * into item;
  if item.id is null then return false; end if;
  perform private.log_messaging_event(item, 'queued', null);
  return true;
end;
$$;

-- A reward is earned: tell the person. It can never fail the visit that earned it.
create function private.on_reward_granted_enqueue_message()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
begin
  begin
    perform private.enqueue_messaging_event(
      new.tenant_id, new.location_id, new.profile_id, 'reward_earned',
      'reward_earned:' || new.id::text,
      jsonb_build_array(
        (select profile.display_name from private.diner_profiles profile
         where profile.tenant_id = new.tenant_id and profile.id = new.profile_id),
        case new.reward_kind
          when 'percent' then (new.reward_value / 100.0)::text || '%'
          else '$' || to_char(new.reward_value / 100.0, 'FM999999990.00') end));
  exception when others then
    null;
  end;
  return new;
end;
$$;
create trigger loyalty_rewards_enqueue_message
after insert on private.loyalty_rewards
for each row execute function private.on_reward_granted_enqueue_message();

-- Time-driven automations: rewards about to expire (3 days), birthdays (the local
-- day) and 90 days without activity. The worker calls this on a timer; it is idempotent.
create function private.enqueue_due_messaging_automations()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
declare
  automation record;
  person record;
  queued integer := 0;
  ok boolean;
begin
  for automation in
    select auto.tenant_id, auto.location_id, auto.kind, location.timezone
    from private.messaging_automations auto
    join public.locations location
      on location.tenant_id = auto.tenant_id and location.id = auto.location_id
    where auto.status = 'approved'
      and auto.kind in ('reward_expiring', 'birthday', 'inactivity')
  loop
    if automation.kind = 'reward_expiring' then
      for person in
        select reward.profile_id, reward.id, reward.expires_at, profile.display_name
        from private.loyalty_rewards reward
        join private.diner_profiles profile
          on profile.tenant_id = reward.tenant_id and profile.id = reward.profile_id
        where reward.tenant_id = automation.tenant_id
          and reward.location_id = automation.location_id
          and reward.status = 'available' and profile.anonymized_at is null
          and reward.expires_at > now() and reward.expires_at <= now() + interval '3 days'
        limit 500
      loop
        ok := private.enqueue_messaging_event(
          automation.tenant_id, automation.location_id, person.profile_id,
          'reward_expiring', 'reward_expiring:' || person.id::text,
          jsonb_build_array(person.display_name,
            to_char(person.expires_at at time zone automation.timezone, 'DD/MM')));
        if ok then queued := queued + 1; end if;
      end loop;
    elsif automation.kind = 'birthday' then
      for person in
        select birthday.profile_id, profile.display_name
        from private.diner_birthdays birthday
        join private.diner_profiles profile
          on profile.tenant_id = birthday.tenant_id and profile.id = birthday.profile_id
        where birthday.tenant_id = automation.tenant_id and profile.anonymized_at is null
          and birthday.birth_month = extract(month from now() at time zone automation.timezone)
          and birthday.birth_day = extract(day from now() at time zone automation.timezone)
        limit 500
      loop
        ok := private.enqueue_messaging_event(
          automation.tenant_id, automation.location_id, person.profile_id,
          'birthday', 'birthday:' || extract(year from now() at time zone automation.timezone)::text,
          jsonb_build_array(person.display_name));
        if ok then queued := queued + 1; end if;
      end loop;
    else
      for person in
        select profile.id as profile_id, profile.display_name,
          private.messaging_last_activity(profile.tenant_id, profile.id) as last_activity
        from private.diner_profiles profile
        where profile.tenant_id = automation.tenant_id and profile.anonymized_at is null
          and profile.whatsapp_phone is not null
          and private.messaging_last_activity(profile.tenant_id, profile.id)
            < now() - interval '90 days'
          and private.messaging_last_activity(profile.tenant_id, profile.id)
            >= now() - interval '12 months'
        limit 500
      loop
        ok := private.enqueue_messaging_event(
          automation.tenant_id, automation.location_id, person.profile_id,
          'inactivity', 'inactivity:' || to_char(person.last_activity, 'YYYY-MM-DD'),
          jsonb_build_array(person.display_name));
        if ok then queued := queued + 1; end if;
      end loop;
    end if;
  end loop;
  return jsonb_build_object('queued', queued);
end;
$$;

-- 10. Webhook: deliveries and "BAJA" --------------------------------------------------------

create function private.claim_messaging_webhook_event(
  target_event_key text,
  target_topic text
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
declare
  inserted bigint;
  processed timestamptz;
begin
  insert into private.messaging_webhook_events (event_key, topic)
  values (target_event_key, target_topic)
  on conflict (event_key) do nothing
  returning id into inserted;
  if inserted is not null then
    return 'new';
  end if;
  select event.processed_at into processed from private.messaging_webhook_events event
  where event.event_key = target_event_key for update;
  if processed is not null then
    return 'duplicate';
  end if;
  update private.messaging_webhook_events event set attempts = event.attempts + 1
  where event.event_key = target_event_key;
  return 'retry';
end;
$$;

create function private.finish_messaging_webhook_event(
  target_event_key text,
  target_outcome text
)
returns void
language sql
volatile
security definer
set search_path = ''
set row_security = off
as $$
  update private.messaging_webhook_events event
  set outcome = target_outcome, processed_at = now()
  where event.event_key = target_event_key and event.processed_at is null;
$$;

-- A delivery status for a message we sent. The business comes from the number the
-- notification names; a message id of another business is simply unknown.
create function private.record_messaging_delivery(
  target_phone_number_id text,
  target_provider_message_id text,
  target_status text,
  target_error text
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
declare
  connection private.whatsapp_connections%rowtype;
  item private.messaging_outbox%rowtype;
begin
  select * into connection from private.whatsapp_connections candidate
  where candidate.phone_number_id = target_phone_number_id;
  if not found then return 'unknown_number'; end if;
  select * into item from private.messaging_outbox candidate
  where candidate.tenant_id = connection.tenant_id
    and candidate.location_id = connection.location_id
    and candidate.provider_message_id = target_provider_message_id
  for update;
  if not found then return 'unknown_message'; end if;
  if target_status in ('delivered', 'read') then
    if item.status = 'sent' then
      update private.messaging_outbox set status = 'delivered', updated_at = now()
      where tenant_id = item.tenant_id and id = item.id;
      perform private.log_messaging_event(item, target_status, null);
      return 'applied';
    elsif item.status = 'delivered' and target_status = 'read' then
      perform private.log_messaging_event(item, 'read', null);
      return 'applied';
    end if;
    return 'unchanged';
  elsif target_status = 'failed' then
    if item.status in ('sent', 'delivered') then
      update private.messaging_outbox set status = 'failed', last_error = left(target_error, 300),
        updated_at = now()
      where tenant_id = item.tenant_id and id = item.id;
      perform private.log_messaging_event(item, 'failed', target_error);
      return 'applied';
    end if;
    return 'unchanged';
  end if;
  return 'unchanged';
end;
$$;

-- Meta reports an Argentine mobile as +54 9 <area> <number> in some places and as
-- +54 <area> <number> in others. For matching a BAJA to a profile both spellings are the
-- same subscriber, so the "9" after 54 is ignored. Other countries (Chile: +56 9 ...)
-- are compared as they are.
create function private.messaging_phone_key(target_phone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when target_phone ~ '^\+549[0-9]{8,11}$'
    then '+54' || substr(target_phone, 5) else target_phone end;
$$;

-- "BAJA": revokes the marketing consent of every profile of THAT business with that
-- phone, with an origin of its own, and stops what was waiting. The same per-person
-- lock as sending, so a message cannot slip through after the revocation.
create function private.record_whatsapp_opt_out(
  target_phone_number_id text,
  target_phone text
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
declare
  connection private.whatsapp_connections%rowtype;
  person record;
  waiting private.messaging_outbox%rowtype;
  state jsonb;
  revoked integer := 0;
begin
  if target_phone !~ '^\+[1-9][0-9]{7,14}$' then return 'ignored'; end if;
  select * into connection from private.whatsapp_connections candidate
  where candidate.phone_number_id = target_phone_number_id;
  if not found then return 'unknown_number'; end if;
  for person in
    select profile.id from private.diner_profiles profile
    where profile.tenant_id = connection.tenant_id
      and private.messaging_phone_key(profile.whatsapp_phone) = private.messaging_phone_key(target_phone)
      and profile.anonymized_at is null
    order by profile.id
  loop
    perform pg_advisory_xact_lock(
      hashtextextended('messaging:' || connection.tenant_id::text || person.id::text, 0));
    perform pg_advisory_xact_lock(
      hashtextextended('diner-consent:' || person.id::text || ':marketing', 0));
    state := private.diner_consent_state(connection.tenant_id, person.id, 'marketing');
    if (state ->> 'granted')::boolean then
      insert into private.diner_consent_events (
        tenant_id, profile_id, kind, action, text_version, source, command_id
      ) values (
        connection.tenant_id, person.id, 'marketing', 'revoked',
        (state ->> 'textVersion')::integer, 'whatsapp_optout', gen_random_uuid());
      revoked := revoked + 1;
    end if;
    for waiting in
      select * from private.messaging_outbox pending
      where pending.tenant_id = connection.tenant_id and pending.profile_id = person.id
        and pending.category = 'promotional'
        and pending.status in ('awaiting_confirmation', 'queued')
      for update
    loop
      update private.messaging_outbox set status = 'blocked', last_error = 'opt_out',
        locked_until = null, updated_at = now()
      where tenant_id = waiting.tenant_id and id = waiting.id;
      perform private.log_messaging_event(waiting, 'blocked', 'opt_out');
    end loop;
    insert into private.messaging_events (
      tenant_id, location_id, profile_id, kind, reason
    ) values (
      connection.tenant_id, connection.location_id, person.id, 'opt_out', 'whatsapp_baja');
  end loop;
  return case when revoked > 0 then 'applied' else 'unchanged' end;
end;
$$;

-- 11. What the Encargado sees ---------------------------------------------------------------

create function private.messaging_template_json(template private.whatsapp_templates)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', template.id, 'name', template.name, 'language', template.language,
    'category', template.category, 'body', template.body,
    'approvalStatus', template.approval_status,
    'estimatedCostCents', template.estimated_cost_cents);
$$;

create function private.messaging_overview_json(
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
  select jsonb_build_object(
    'connection', (
      select jsonb_build_object(
        'phoneNumberId', connection.phone_number_id, 'wabaId', connection.waba_id,
        'displayPhone', connection.display_phone, 'sendingEnabled', connection.sending_enabled,
        'connectedAt', connection.connected_at)
      from private.whatsapp_connections connection
      where connection.tenant_id = target_tenant_id
        and connection.location_id = target_location_id),
    'templates', coalesce((
      select jsonb_agg(private.messaging_template_json(template)
        order by template.name, template.language)
      from private.whatsapp_templates template
      where template.tenant_id = target_tenant_id
        and template.location_id = target_location_id), '[]'::jsonb),
    'automations', (
      select jsonb_agg(jsonb_build_object(
        'kind', kind.name, 'id', auto.id, 'templateId', auto.template_id,
        'templateName', template.name, 'status', coalesce(auto.status, 'not_configured'),
        'approvedAt', auto.approved_at) order by kind.position)
      from (values ('reward_earned', 1), ('reward_expiring', 2), ('birthday', 3),
        ('inactivity', 4)) as kind(name, position)
      left join private.messaging_automations auto
        on auto.tenant_id = target_tenant_id and auto.location_id = target_location_id
        and auto.kind = kind.name
      left join private.whatsapp_templates template
        on template.tenant_id = auto.tenant_id and template.id = auto.template_id),
    'oneOffEvents', coalesce((
      select jsonb_agg(batch.entry order by batch.created_at)
      from (
        select min(item.created_at) as created_at, jsonb_build_object(
          'batchId', item.batch_id, 'templateName', min(item.template_name),
          'recipients', count(*)) as entry
        from private.messaging_outbox item
        where item.tenant_id = target_tenant_id and item.location_id = target_location_id
          and item.origin = 'one_off' and item.status = 'awaiting_confirmation'
        group by item.batch_id) batch), '[]'::jsonb),
    'usage', (
      select jsonb_build_object(
        'sentThisMonth', count(*),
        'estimatedCostCents', coalesce(sum(item.estimated_cost_cents), 0))
      from private.messaging_outbox item
      where item.tenant_id = target_tenant_id and item.location_id = target_location_id
        and item.status in ('sent', 'delivered')
        and item.sent_at >= date_trunc('month', now())));
$$;

create function private.require_messaging_manager(
  target_tenant_id uuid,
  target_location_id uuid,
  target_staff_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = ''
set row_security = off
as $$
begin
  if private.waiter_actor_role(target_tenant_id, target_location_id, target_staff_id)
    <> 'manager'
  then
    raise exception 'only a manager can manage messaging' using errcode = 'PT222';
  end if;
end;
$$;

create function private.get_messaging_overview(
  target_tenant_id uuid,
  target_location_id uuid,
  target_staff_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set row_security = off
as $$
begin
  perform private.require_messaging_manager(
    target_tenant_id, target_location_id, target_staff_id);
  return private.messaging_overview_json(target_tenant_id, target_location_id);
end;
$$;

create function private.list_messaging_events(
  target_tenant_id uuid,
  target_location_id uuid,
  target_staff_id uuid,
  target_limit integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set row_security = off
as $$
begin
  perform private.require_messaging_manager(
    target_tenant_id, target_location_id, target_staff_id);
  return coalesce((
    select jsonb_agg(row_to_json_entry.entry order by row_to_json_entry.id desc)
    from (
      select event.id, jsonb_build_object(
        'id', event.id, 'kind', event.kind, 'reason', event.reason,
        'occurredAt', event.occurred_at, 'displayName', profile.display_name,
        'templateName', item.template_name, 'category', item.category,
        'origin', item.origin) as entry
      from private.messaging_events event
      left join private.diner_profiles profile
        on profile.tenant_id = event.tenant_id and profile.id = event.profile_id
      left join private.messaging_outbox item
        on item.tenant_id = event.tenant_id and item.id = event.outbox_id
      where event.tenant_id = target_tenant_id and event.location_id = target_location_id
      order by event.id desc
      limit least(greatest(coalesce(target_limit, 50), 1), 200)
    ) row_to_json_entry), '[]'::jsonb);
end;
$$;

-- People the Encargado can choose for a one-off event: name and consents, no phone.
create function private.list_messaging_audience(
  target_tenant_id uuid,
  target_location_id uuid,
  target_staff_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set row_security = off
as $$
begin
  perform private.require_messaging_manager(
    target_tenant_id, target_location_id, target_staff_id);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'profileId', profile.id, 'displayName', profile.display_name,
      'whatsappConsent', private.messaging_consent_ok(profile.tenant_id, profile.id, 'operational'),
      'marketingConsent', private.messaging_consent_ok(profile.tenant_id, profile.id, 'promotional'))
      order by profile.display_name, profile.id)
    from (
      select * from private.diner_profiles candidate
      where candidate.tenant_id = target_tenant_id and candidate.anonymized_at is null
        and candidate.whatsapp_phone is not null
      order by candidate.display_name, candidate.id
      limit 500) profile), '[]'::jsonb);
end;
$$;

-- 12. Connect, disconnect, sending switch, templates ----------------------------------------

create function private.connect_whatsapp(
  target_tenant_id uuid,
  target_location_id uuid,
  target_staff_id uuid,
  target_phone_number_id text,
  target_waba_id text,
  target_display_phone text,
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
begin
  perform private.require_messaging_manager(
    target_tenant_id, target_location_id, target_staff_id);
  if exists (
    select 1 from private.whatsapp_connections connection
    where connection.phone_number_id = target_phone_number_id
      and (connection.tenant_id, connection.location_id)
        is distinct from (target_tenant_id, target_location_id))
  then
    raise exception 'that number is connected elsewhere' using errcode = 'PT294';
  end if;
  begin
    insert into private.whatsapp_connections (
      tenant_id, location_id, phone_number_id, waba_id, display_phone,
      ciphertext, key_version, connected_by
    ) values (
      target_tenant_id, target_location_id, target_phone_number_id, target_waba_id,
      target_display_phone, target_ciphertext, target_key_version, target_staff_id)
    on conflict (tenant_id, location_id) do update set
      phone_number_id = excluded.phone_number_id, waba_id = excluded.waba_id,
      display_phone = excluded.display_phone, ciphertext = excluded.ciphertext,
      key_version = excluded.key_version, connected_by = excluded.connected_by,
      connected_at = now(), updated_at = now();
  exception when check_violation or not_null_violation then
    raise exception 'invalid connection' using errcode = 'PT297';
  when unique_violation then
    raise exception 'that number is connected elsewhere' using errcode = 'PT294';
  end;
  perform private.append_audit_event(
    target_tenant_id, 'staff', target_staff_id, 'messaging.connected',
    'WhatsApp conectado', 'messaging:' || gen_random_uuid()::text,
    'location', target_location_id);
  return private.messaging_overview_json(target_tenant_id, target_location_id);
end;
$$;

create function private.disconnect_whatsapp(
  target_tenant_id uuid,
  target_location_id uuid,
  target_staff_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
declare
  waiting private.messaging_outbox%rowtype;
begin
  perform private.require_messaging_manager(
    target_tenant_id, target_location_id, target_staff_id);
  delete from private.whatsapp_connections connection
  where connection.tenant_id = target_tenant_id and connection.location_id = target_location_id;
  for waiting in
    select * from private.messaging_outbox pending
    where pending.tenant_id = target_tenant_id and pending.location_id = target_location_id
      and pending.status in ('awaiting_confirmation', 'queued')
    for update
  loop
    update private.messaging_outbox set status = 'cancelled', last_error = 'disconnected',
      locked_until = null, updated_at = now()
    where tenant_id = waiting.tenant_id and id = waiting.id;
    perform private.log_messaging_event(waiting, 'cancelled', 'disconnected');
  end loop;
  update private.messaging_automations set template_id = null, status = 'pending_approval',
    approved_by = null, approved_at = null, updated_at = now()
  where tenant_id = target_tenant_id and location_id = target_location_id;
  delete from private.whatsapp_templates template
  where template.tenant_id = target_tenant_id and template.location_id = target_location_id;
  perform private.append_audit_event(
    target_tenant_id, 'staff', target_staff_id, 'messaging.disconnected',
    'WhatsApp desconectado', 'messaging:' || gen_random_uuid()::text,
    'location', target_location_id);
  return private.messaging_overview_json(target_tenant_id, target_location_id);
end;
$$;

create function private.set_whatsapp_sending(
  target_tenant_id uuid,
  target_location_id uuid,
  target_staff_id uuid,
  target_enabled boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
begin
  perform private.require_messaging_manager(
    target_tenant_id, target_location_id, target_staff_id);
  update private.whatsapp_connections connection
  set sending_enabled = target_enabled, updated_at = now()
  where connection.tenant_id = target_tenant_id and connection.location_id = target_location_id;
  if not found then
    raise exception 'whatsapp is not connected' using errcode = 'PT293';
  end if;
  perform private.append_audit_event(
    target_tenant_id, 'staff', target_staff_id,
    case when target_enabled then 'messaging.sending_enabled' else 'messaging.sending_disabled' end,
    case when target_enabled then 'Envíos de WhatsApp activados' else 'Envíos de WhatsApp apagados' end,
    'messaging:' || gen_random_uuid()::text, 'location', target_location_id);
  return private.messaging_overview_json(target_tenant_id, target_location_id);
end;
$$;

-- Templates come from the provider: [{name, language, category, body, status}].
-- A template whose text or category changed sends its automations back to approval.
create function private.upsert_whatsapp_templates(
  target_tenant_id uuid,
  target_location_id uuid,
  target_staff_id uuid,
  target_templates jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
declare
  entry jsonb;
  existing private.whatsapp_templates%rowtype;
  saved_id uuid;
begin
  perform private.require_messaging_manager(
    target_tenant_id, target_location_id, target_staff_id);
  if not exists (
    select 1 from private.whatsapp_connections connection
    where connection.tenant_id = target_tenant_id and connection.location_id = target_location_id)
  then
    raise exception 'whatsapp is not connected' using errcode = 'PT293';
  end if;
  if jsonb_typeof(target_templates) <> 'array' or jsonb_array_length(target_templates) > 200 then
    raise exception 'invalid templates' using errcode = 'PT297';
  end if;
  for entry in select value from jsonb_array_elements(target_templates) loop
    begin
      select * into existing from private.whatsapp_templates candidate
      where candidate.tenant_id = target_tenant_id and candidate.location_id = target_location_id
        and candidate.name = entry ->> 'name' and candidate.language = entry ->> 'language'
      for update;
      if found then
        update private.whatsapp_templates
        set category = entry ->> 'category', body = entry ->> 'body',
            approval_status = entry ->> 'status', synced_at = now()
        where tenant_id = target_tenant_id and id = existing.id;
        saved_id := existing.id;
        if existing.body is distinct from entry ->> 'body'
          or existing.category is distinct from entry ->> 'category'
        then
          update private.messaging_automations
          set status = 'pending_approval', approved_by = null, approved_at = null,
              updated_at = now()
          where tenant_id = target_tenant_id and template_id = saved_id
            and status <> 'pending_approval';
        end if;
      else
        insert into private.whatsapp_templates (
          tenant_id, location_id, name, language, category, body, approval_status
        ) values (
          target_tenant_id, target_location_id, entry ->> 'name', entry ->> 'language',
          entry ->> 'category', entry ->> 'body', entry ->> 'status');
      end if;
    exception when check_violation or not_null_violation then
      raise exception 'invalid templates' using errcode = 'PT297';
    end;
  end loop;
  return private.messaging_overview_json(target_tenant_id, target_location_id);
end;
$$;

create function private.set_whatsapp_template_cost(
  target_tenant_id uuid,
  target_location_id uuid,
  target_staff_id uuid,
  target_template_id uuid,
  target_cost_cents numeric
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
begin
  perform private.require_messaging_manager(
    target_tenant_id, target_location_id, target_staff_id);
  begin
    update private.whatsapp_templates template
    set estimated_cost_cents = target_cost_cents
    where template.tenant_id = target_tenant_id and template.location_id = target_location_id
      and template.id = target_template_id;
  exception when check_violation or numeric_value_out_of_range or not_null_violation then
    raise exception 'invalid cost' using errcode = 'PT297';
  end;
  if not found then
    raise exception 'unknown template' using errcode = 'PT295';
  end if;
  return private.messaging_overview_json(target_tenant_id, target_location_id);
end;
$$;

-- 13. Automations: configured, then approved once -------------------------------------------

create function private.save_messaging_automation(
  target_tenant_id uuid,
  target_location_id uuid,
  target_staff_id uuid,
  target_kind text,
  target_template_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
begin
  perform private.require_messaging_manager(
    target_tenant_id, target_location_id, target_staff_id);
  if target_kind not in ('reward_earned', 'reward_expiring', 'birthday', 'inactivity') then
    raise exception 'unknown automation' using errcode = 'PT296';
  end if;
  if not exists (
    select 1 from private.whatsapp_templates template
    where template.tenant_id = target_tenant_id and template.location_id = target_location_id
      and template.id = target_template_id and template.approval_status = 'approved')
  then
    raise exception 'the template is not approved' using errcode = 'PT295';
  end if;
  -- Changing the template always asks for a new approval.
  insert into private.messaging_automations (
    tenant_id, location_id, kind, template_id, status
  ) values (
    target_tenant_id, target_location_id, target_kind, target_template_id, 'pending_approval')
  on conflict (tenant_id, location_id, kind) do update set
    template_id = excluded.template_id,
    status = case when private.messaging_automations.template_id = excluded.template_id
      then private.messaging_automations.status else 'pending_approval' end,
    approved_by = case when private.messaging_automations.template_id = excluded.template_id
      then private.messaging_automations.approved_by else null end,
    approved_at = case when private.messaging_automations.template_id = excluded.template_id
      then private.messaging_automations.approved_at else null end,
    updated_at = now();
  return private.messaging_overview_json(target_tenant_id, target_location_id);
end;
$$;

create function private.decide_messaging_automation(
  target_tenant_id uuid,
  target_location_id uuid,
  target_staff_id uuid,
  target_automation_id uuid,
  target_decision text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
declare
  automation private.messaging_automations%rowtype;
begin
  perform private.require_messaging_manager(
    target_tenant_id, target_location_id, target_staff_id);
  if target_decision not in ('approve', 'pause', 'resume') then
    raise exception 'invalid decision' using errcode = 'PT296';
  end if;
  select * into automation from private.messaging_automations candidate
  where candidate.tenant_id = target_tenant_id and candidate.location_id = target_location_id
    and candidate.id = target_automation_id
  for update;
  if not found then
    raise exception 'unknown automation' using errcode = 'PT296';
  end if;
  if target_decision = 'approve' then
    if automation.status = 'pending_approval' then
      if automation.template_id is null or not exists (
        select 1 from private.whatsapp_templates template
        where template.tenant_id = target_tenant_id and template.id = automation.template_id
          and template.approval_status = 'approved')
      then
        raise exception 'the template is not approved' using errcode = 'PT295';
      end if;
      update private.messaging_automations set status = 'approved',
        approved_by = target_staff_id, approved_at = now(), updated_at = now()
      where tenant_id = target_tenant_id and id = target_automation_id;
      perform private.append_audit_event(
        target_tenant_id, 'staff', target_staff_id, 'messaging.automation_approved',
        'Automatización de mensajes aprobada', 'messaging:' || gen_random_uuid()::text,
        'location', target_location_id);
    elsif automation.status = 'paused' then
      raise exception 'resume the paused automation instead' using errcode = 'PT296';
    end if;
  elsif target_decision = 'pause' then
    if automation.status = 'pending_approval' then
      raise exception 'nothing to pause' using errcode = 'PT296';
    end if;
    update private.messaging_automations set status = 'paused', updated_at = now()
    where tenant_id = target_tenant_id and id = target_automation_id;
  else
    if automation.status = 'pending_approval' then
      raise exception 'approve the automation first' using errcode = 'PT296';
    end if;
    update private.messaging_automations set status = 'approved', updated_at = now()
    where tenant_id = target_tenant_id and id = target_automation_id;
  end if;
  return private.messaging_overview_json(target_tenant_id, target_location_id);
end;
$$;

-- 14. One-off events: proposed, then confirmed --------------------------------------------

create function private.propose_one_off_event(
  target_tenant_id uuid,
  target_location_id uuid,
  target_staff_id uuid,
  target_command_id uuid,
  target_template_id uuid,
  target_profile_ids uuid[],
  target_variables jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
declare
  template private.whatsapp_templates%rowtype;
  existing_template uuid;
  people uuid[];
  total integer;
begin
  perform private.require_messaging_manager(
    target_tenant_id, target_location_id, target_staff_id);
  if jsonb_typeof(target_variables) <> 'array' or jsonb_array_length(target_variables) > 10
    or exists (select 1 from jsonb_array_elements(target_variables) element
      where jsonb_typeof(element) <> 'string' or length(element #>> '{}') > 200)
  then
    raise exception 'invalid variables' using errcode = 'PT297';
  end if;
  people := array(select distinct person from unnest(target_profile_ids) person);
  total := coalesce(array_length(people, 1), 0);
  if total not between 1 and 200 then
    raise exception 'between 1 and 200 recipients' using errcode = 'PT297';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended('messaging-batch:' || target_tenant_id::text || target_command_id::text, 0));
  select item.template_id into existing_template from private.messaging_outbox item
  where item.tenant_id = target_tenant_id and item.batch_id = target_command_id limit 1;
  if existing_template is not null then
    if existing_template <> target_template_id then
      raise exception 'command id reused with other data' using errcode = 'PT297';
    end if;
    return jsonb_build_object('batchId', target_command_id, 'recipients', (
      select count(*) from private.messaging_outbox item
      where item.tenant_id = target_tenant_id and item.batch_id = target_command_id));
  end if;
  select * into template from private.whatsapp_templates candidate
  where candidate.tenant_id = target_tenant_id and candidate.location_id = target_location_id
    and candidate.id = target_template_id and candidate.approval_status = 'approved';
  if not found then
    raise exception 'the template is not approved' using errcode = 'PT295';
  end if;
  if not exists (
    select 1 from private.whatsapp_connections connection
    where connection.tenant_id = target_tenant_id and connection.location_id = target_location_id)
  then
    raise exception 'whatsapp is not connected' using errcode = 'PT293';
  end if;
  if (select count(*) from private.diner_profiles profile
      where profile.tenant_id = target_tenant_id and profile.id = any (people)
        and profile.anonymized_at is null) <> total
  then
    raise exception 'unknown recipients' using errcode = 'PT297';
  end if;
  insert into private.messaging_outbox (
    tenant_id, location_id, profile_id, origin, batch_id, event_key, template_id,
    template_name, template_language, category, estimated_cost_cents, variables, status
  )
  select target_tenant_id, target_location_id, person, 'one_off', target_command_id,
    'one_off:' || target_command_id::text, template.id, template.name, template.language,
    template.category, template.estimated_cost_cents, target_variables,
    'awaiting_confirmation'
  from unnest(people) person
  on conflict (tenant_id, profile_id, event_key) do nothing;
  return jsonb_build_object('batchId', target_command_id, 'recipients', total);
end;
$$;

create function private.decide_one_off_event(
  target_tenant_id uuid,
  target_location_id uuid,
  target_staff_id uuid,
  target_batch_id uuid,
  target_decision text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
declare
  waiting private.messaging_outbox%rowtype;
  changed integer := 0;
begin
  perform private.require_messaging_manager(
    target_tenant_id, target_location_id, target_staff_id);
  if target_decision not in ('confirm', 'cancel') then
    raise exception 'invalid decision' using errcode = 'PT298';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended('messaging-batch:' || target_tenant_id::text || target_batch_id::text, 0));
  if not exists (
    select 1 from private.messaging_outbox item
    where item.tenant_id = target_tenant_id and item.location_id = target_location_id
      and item.batch_id = target_batch_id)
  then
    raise exception 'unknown event' using errcode = 'PT298';
  end if;
  -- Confirming twice does nothing the second time: only waiting messages move.
  for waiting in
    select * from private.messaging_outbox item
    where item.tenant_id = target_tenant_id and item.location_id = target_location_id
      and item.batch_id = target_batch_id and item.status = 'awaiting_confirmation'
    for update
  loop
    if target_decision = 'confirm' then
      update private.messaging_outbox set status = 'queued', confirmed_by = target_staff_id,
        confirmed_at = now(), next_attempt_at = now(), updated_at = now()
      where tenant_id = waiting.tenant_id and id = waiting.id;
      perform private.log_messaging_event(waiting, 'queued', null);
    else
      update private.messaging_outbox set status = 'cancelled', last_error = 'cancelled_by_manager',
        updated_at = now()
      where tenant_id = waiting.tenant_id and id = waiting.id;
      perform private.log_messaging_event(waiting, 'cancelled', 'cancelled_by_manager');
    end if;
    changed := changed + 1;
  end loop;
  if changed > 0 then
    perform private.append_audit_event(
      target_tenant_id, 'staff', target_staff_id,
      case target_decision when 'confirm' then 'messaging.one_off_confirmed'
        else 'messaging.one_off_cancelled' end,
      case target_decision when 'confirm' then 'Evento puntual de mensajes confirmado'
        else 'Evento puntual de mensajes cancelado' end,
      'messaging:' || gen_random_uuid()::text, 'location', target_location_id);
  end if;
  return jsonb_build_object('batchId', target_batch_id, 'changed', changed);
end;
$$;

-- 15. Privileges ------------------------------------------------------------------------------

revoke all on function
  private.messaging_last_activity(uuid, uuid),
  private.messaging_consent_ok(uuid, uuid, text),
  private.messaging_send_decision(uuid, uuid, uuid, timestamptz),
  private.log_messaging_event(private.messaging_outbox, text, text),
  private.claim_messaging_outbox(integer, integer),
  private.begin_messaging_send(uuid, uuid, uuid),
  private.finish_messaging_send(uuid, uuid, uuid, text, text, text),
  private.read_whatsapp_credentials(uuid, uuid),
  private.enqueue_messaging_event(uuid, uuid, uuid, text, text, jsonb),
  private.on_reward_granted_enqueue_message(),
  private.enqueue_due_messaging_automations(),
  private.claim_messaging_webhook_event(text, text),
  private.finish_messaging_webhook_event(text, text),
  private.record_messaging_delivery(text, text, text, text),
  private.record_whatsapp_opt_out(text, text),
  private.messaging_phone_key(text),
  private.messaging_template_json(private.whatsapp_templates),
  private.messaging_overview_json(uuid, uuid),
  private.require_messaging_manager(uuid, uuid, uuid),
  private.get_messaging_overview(uuid, uuid, uuid),
  private.list_messaging_events(uuid, uuid, uuid, integer),
  private.list_messaging_audience(uuid, uuid, uuid),
  private.connect_whatsapp(uuid, uuid, uuid, text, text, text, bytea, smallint),
  private.disconnect_whatsapp(uuid, uuid, uuid),
  private.set_whatsapp_sending(uuid, uuid, uuid, boolean),
  private.upsert_whatsapp_templates(uuid, uuid, uuid, jsonb),
  private.set_whatsapp_template_cost(uuid, uuid, uuid, uuid, numeric),
  private.save_messaging_automation(uuid, uuid, uuid, text, uuid),
  private.decide_messaging_automation(uuid, uuid, uuid, uuid, text),
  private.propose_one_off_event(uuid, uuid, uuid, uuid, uuid, uuid[], jsonb),
  private.decide_one_off_event(uuid, uuid, uuid, uuid, text)
from public, anon, authenticated, authenticator;

-- The API and the worker reach these entry points and nothing else.
grant execute on function
  private.claim_messaging_outbox(integer, integer),
  private.begin_messaging_send(uuid, uuid, uuid),
  private.finish_messaging_send(uuid, uuid, uuid, text, text, text),
  private.read_whatsapp_credentials(uuid, uuid),
  private.enqueue_due_messaging_automations(),
  private.claim_messaging_webhook_event(text, text),
  private.finish_messaging_webhook_event(text, text),
  private.record_messaging_delivery(text, text, text, text),
  private.record_whatsapp_opt_out(text, text),
  private.get_messaging_overview(uuid, uuid, uuid),
  private.list_messaging_events(uuid, uuid, uuid, integer),
  private.list_messaging_audience(uuid, uuid, uuid),
  private.connect_whatsapp(uuid, uuid, uuid, text, text, text, bytea, smallint),
  private.disconnect_whatsapp(uuid, uuid, uuid),
  private.set_whatsapp_sending(uuid, uuid, uuid, boolean),
  private.upsert_whatsapp_templates(uuid, uuid, uuid, jsonb),
  private.set_whatsapp_template_cost(uuid, uuid, uuid, uuid, numeric),
  private.save_messaging_automation(uuid, uuid, uuid, text, uuid),
  private.decide_messaging_automation(uuid, uuid, uuid, uuid, text),
  private.propose_one_off_event(uuid, uuid, uuid, uuid, uuid, uuid[], jsonb),
  private.decide_one_off_event(uuid, uuid, uuid, uuid, text)
to authenticator;

commit;
