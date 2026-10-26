begin;

-- T30 (second channel): notifications of the installed PWA (Web Push) next to WhatsApp.
--
-- The sending policy, the queue, the history, the automations and the one-off events are
-- the same ones WhatsApp uses; only the channel differs. A message belongs to a channel
-- ('whatsapp' or 'web_push'), a template (the restaurant's own text, no Meta approval for
-- push) and a person. A person is reached by push through the browsers they subscribed from.
--
-- Consent: a push subscription is an explicit act of the person (the browser permission
-- plus our button), recorded with its date and revocable (unsubscribing, or the push
-- service reporting the endpoint gone). It covers operational notices. Promotional pushes
-- ALSO need the `marketing` consent, read from the append-only history like WhatsApp.
-- The quotas (2 a week, 8 a month) are shared by both channels: they count people, not
-- channels. Real sending stays off per location until someone turns it on.
--
-- Error codes: reuses PT282 (profile required), PT293-PT298.

-- 1. Channel columns ------------------------------------------------------------------------

alter table private.whatsapp_templates
  add column channel text not null default 'whatsapp'
    check (channel in ('whatsapp', 'web_push'));
alter table private.whatsapp_templates
  drop constraint whatsapp_templates_tenant_id_location_id_name_language_key;
alter table private.whatsapp_templates
  add constraint whatsapp_templates_channel_name_key
  unique (tenant_id, location_id, channel, name, language);

alter table private.messaging_automations
  add column channel text not null default 'whatsapp'
    check (channel in ('whatsapp', 'web_push'));
alter table private.messaging_automations
  drop constraint messaging_automations_tenant_id_location_id_kind_key;
alter table private.messaging_automations
  add constraint messaging_automations_channel_kind_key
  unique (tenant_id, location_id, kind, channel);

alter table private.messaging_outbox
  add column channel text not null default 'whatsapp'
    check (channel in ('whatsapp', 'web_push'));

-- 2. Subscriptions and settings -------------------------------------------------------------

create table private.push_subscriptions (
  id uuid not null default gen_random_uuid(),
  tenant_id uuid not null,
  profile_id uuid not null,
  endpoint text not null check (endpoint ~ '^https://' and length(endpoint) <= 2000),
  p256dh text not null check (p256dh ~ '^[A-Za-z0-9_-]{80,100}$'),
  auth text not null check (auth ~ '^[A-Za-z0-9_-]{20,30}$'),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_reason text check (revoked_reason in ('diner', 'gone', 'replaced', 'anonymized')),
  primary key (tenant_id, id),
  unique (endpoint),
  foreign key (tenant_id, profile_id)
    references private.diner_profiles(tenant_id, id) on delete cascade,
  check ((revoked_at is null) = (revoked_reason is null))
);
create index push_subscriptions_profile_idx
  on private.push_subscriptions (tenant_id, profile_id) where revoked_at is null;

create table private.push_settings (
  tenant_id uuid not null,
  location_id uuid not null,
  -- Real sending stays off until someone turns it on, on purpose.
  sending_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, location_id),
  foreign key (tenant_id, location_id)
    references public.locations(tenant_id, id) on delete cascade
);

revoke all on table private.push_subscriptions, private.push_settings
from public, anon, authenticated, authenticator;

-- 3. Consent and reachability per channel --------------------------------------------------

create function private.push_active(target_tenant_id uuid, target_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select exists (
    select 1 from private.push_subscriptions subscription
    where subscription.tenant_id = target_tenant_id
      and subscription.profile_id = target_profile_id
      and subscription.revoked_at is null);
$$;

-- WhatsApp: the consents of the history. Push: an active subscription, plus the
-- marketing consent for promotions.
create function private.messaging_channel_ok(
  target_tenant_id uuid,
  target_profile_id uuid,
  target_category text,
  target_channel text
)
returns boolean
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select case target_channel
    when 'whatsapp' then
      private.messaging_consent_ok(target_tenant_id, target_profile_id, target_category)
    else
      private.push_active(target_tenant_id, target_profile_id)
      and (target_category = 'operational' or coalesce(
        (private.diner_consent_state(
          target_tenant_id, target_profile_id, 'marketing') ->> 'granted')::boolean, false))
  end;
$$;

-- 4. The decision, now channel aware -------------------------------------------------------

create or replace function private.messaging_send_decision(
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
  settings private.push_settings%rowtype;
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
  if item.channel = 'whatsapp' then
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
  else
    select * into settings from private.push_settings candidate
    where candidate.tenant_id = target_tenant_id and candidate.location_id = target_location_id;
    if not found or not settings.sending_enabled then
      return jsonb_build_object('action', 'block', 'reason', 'sending_disabled');
    end if;
    if not private.push_active(target_tenant_id, item.profile_id) then
      return jsonb_build_object('action', 'block', 'reason', 'no_subscription');
    end if;
  end if;
  select * into template from private.whatsapp_templates candidate
  where candidate.tenant_id = target_tenant_id and candidate.id = item.template_id
    and candidate.location_id = target_location_id and candidate.channel = item.channel;
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

  if not private.messaging_channel_ok(
    target_tenant_id, item.profile_id, item.category, item.channel)
  then
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
  -- Both channels count: the allowance belongs to the person.
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

-- 5. begin: what the worker needs for each channel ------------------------------------------

create or replace function private.begin_messaging_send(
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
  template_body text;
  title text;
  rendered text;
  subscriptions jsonb;
  idx integer;
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

  update private.messaging_outbox
  set status = 'sending', attempts = item.attempts + 1, sent_at = now(),
      locked_until = now() + interval '2 minutes', updated_at = now()
  where tenant_id = target_tenant_id and id = target_outbox_id;

  if item.channel = 'web_push' then
    select template.body into template_body from private.whatsapp_templates template
    where template.tenant_id = target_tenant_id and template.id = item.template_id;
    rendered := template_body;
    for idx in 1..jsonb_array_length(item.variables) loop
      rendered := replace(rendered, '{{' || idx::text || '}}',
        item.variables ->> (idx - 1));
    end loop;
    select tenant.name into title from public.tenants tenant where tenant.id = target_tenant_id;
    select coalesce(jsonb_agg(jsonb_build_object(
      'endpoint', subscription.endpoint, 'p256dh', subscription.p256dh,
      'auth', subscription.auth) order by subscription.created_at), '[]'::jsonb)
    into subscriptions
    from private.push_subscriptions subscription
    where subscription.tenant_id = target_tenant_id and subscription.profile_id = item.profile_id
      and subscription.revoked_at is null;
    return jsonb_build_object(
      'action', 'send', 'channel', 'web_push', 'category', item.category,
      'title', title, 'body', left(rendered, 240), 'url', '/cuenta',
      'subscriptions', subscriptions, 'attempt', item.attempts + 1);
  end if;

  select profile.whatsapp_phone into phone from private.diner_profiles profile
  where profile.tenant_id = target_tenant_id and profile.id = item.profile_id;
  select connection.phone_number_id into phone_number from private.whatsapp_connections connection
  where connection.tenant_id = target_tenant_id and connection.location_id = target_location_id;
  return jsonb_build_object(
    'action', 'send', 'channel', 'whatsapp', 'phone', phone, 'phoneNumberId', phone_number,
    'templateName', item.template_name, 'language', item.template_language,
    'category', item.category, 'variables', item.variables,
    'attempt', item.attempts + 1);
end;
$$;

-- 6. Events: one message per channel the restaurant has an approved automation for ----------

create or replace function private.enqueue_messaging_event(
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
  queued boolean := false;
begin
  for automation in
    select * from private.messaging_automations candidate
    where candidate.tenant_id = target_tenant_id and candidate.location_id = target_location_id
      and candidate.kind = target_kind and candidate.status = 'approved'
    order by candidate.channel
  loop
    select * into template from private.whatsapp_templates candidate
    where candidate.tenant_id = target_tenant_id and candidate.id = automation.template_id
      and candidate.approval_status = 'approved' and candidate.channel = automation.channel;
    if not found then continue; end if;
    if automation.channel = 'whatsapp' then
      if not exists (
        select 1 from private.whatsapp_connections connection
        where connection.tenant_id = target_tenant_id
          and connection.location_id = target_location_id)
        or not exists (
          select 1 from private.diner_profiles profile
          where profile.tenant_id = target_tenant_id and profile.id = target_profile_id
            and profile.anonymized_at is null and profile.whatsapp_phone is not null)
      then continue; end if;
    elsif not exists (
      select 1 from private.diner_profiles profile
      where profile.tenant_id = target_tenant_id and profile.id = target_profile_id
        and profile.anonymized_at is null)
    then continue; end if;
    if not private.messaging_channel_ok(
      target_tenant_id, target_profile_id, template.category, automation.channel)
    then continue; end if;
    item := null;
    insert into private.messaging_outbox (
      tenant_id, location_id, profile_id, origin, automation_id, event_key, template_id,
      template_name, template_language, category, estimated_cost_cents, variables, channel
    ) values (
      target_tenant_id, target_location_id, target_profile_id, 'automation', automation.id,
      case automation.channel when 'web_push' then 'push:' || target_event_key
        else target_event_key end,
      template.id, template.name, template.language, template.category,
      template.estimated_cost_cents, target_variables, automation.channel)
    on conflict (tenant_id, profile_id, event_key) do nothing
    returning * into item;
    if item.id is not null then
      perform private.log_messaging_event(item, 'queued', null);
      queued := true;
    end if;
  end loop;
  return queued;
end;
$$;

-- The time-driven automations look at each kind once, whatever the channels.
create or replace function private.enqueue_due_messaging_automations()
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
    select distinct on (auto.tenant_id, auto.location_id, auto.kind)
      auto.tenant_id, auto.location_id, auto.kind, location.timezone
    from private.messaging_automations auto
    join public.locations location
      on location.tenant_id = auto.tenant_id and location.id = auto.location_id
    where auto.status = 'approved'
      and auto.kind in ('reward_expiring', 'birthday', 'inactivity')
    order by auto.tenant_id, auto.location_id, auto.kind
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
          and (profile.whatsapp_phone is not null
            or private.push_active(profile.tenant_id, profile.id))
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

-- 7. What the Encargado sees ---------------------------------------------------------------

create or replace function private.messaging_template_json(template private.whatsapp_templates)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', template.id, 'name', template.name, 'language', template.language,
    'category', template.category, 'body', template.body,
    'approvalStatus', template.approval_status,
    'estimatedCostCents', template.estimated_cost_cents,
    'channel', template.channel);
$$;

create or replace function private.messaging_overview_json(
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
    'push', jsonb_build_object(
      'sendingEnabled', coalesce((
        select settings.sending_enabled from private.push_settings settings
        where settings.tenant_id = target_tenant_id
          and settings.location_id = target_location_id), false),
      'subscribers', (
        select count(distinct subscription.profile_id)
        from private.push_subscriptions subscription
        where subscription.tenant_id = target_tenant_id and subscription.revoked_at is null)),
    'templates', coalesce((
      select jsonb_agg(private.messaging_template_json(template)
        order by template.channel, template.name, template.language)
      from private.whatsapp_templates template
      where template.tenant_id = target_tenant_id
        and template.location_id = target_location_id), '[]'::jsonb),
    'automations', (
      select jsonb_agg(jsonb_build_object(
        'kind', kind.name, 'channel', channel.name, 'id', auto.id,
        'templateId', auto.template_id, 'templateName', template.name,
        'status', coalesce(auto.status, 'not_configured'),
        'approvedAt', auto.approved_at) order by channel.position, kind.position)
      from (values ('reward_earned', 1), ('reward_expiring', 2), ('birthday', 3),
        ('inactivity', 4)) as kind(name, position)
      cross join (values ('whatsapp', 1), ('web_push', 2)) as channel(name, position)
      left join private.messaging_automations auto
        on auto.tenant_id = target_tenant_id and auto.location_id = target_location_id
        and auto.kind = kind.name and auto.channel = channel.name
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

-- People the Encargado can choose for a one-off event: name and what each channel allows.
create or replace function private.list_messaging_audience(
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
      'whatsappConsent', profile.whatsapp_phone is not null
        and private.messaging_consent_ok(profile.tenant_id, profile.id, 'operational'),
      'marketingConsent', profile.whatsapp_phone is not null
        and private.messaging_consent_ok(profile.tenant_id, profile.id, 'promotional'),
      'pushConsent', private.push_active(profile.tenant_id, profile.id),
      'pushMarketingConsent', private.messaging_channel_ok(
        profile.tenant_id, profile.id, 'promotional', 'web_push'))
      order by profile.display_name, profile.id)
    from (
      select * from private.diner_profiles candidate
      where candidate.tenant_id = target_tenant_id and candidate.anonymized_at is null
        and (candidate.whatsapp_phone is not null
          or private.push_active(candidate.tenant_id, candidate.id))
      order by candidate.display_name, candidate.id
      limit 500) profile), '[]'::jsonb);
end;
$$;

-- 8. Functions that now know about channels -------------------------------------------------

create or replace function private.disconnect_whatsapp(
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
      and pending.channel = 'whatsapp'
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
  where tenant_id = target_tenant_id and location_id = target_location_id
    and channel = 'whatsapp';
  delete from private.whatsapp_templates template
  where template.tenant_id = target_tenant_id and template.location_id = target_location_id
    and template.channel = 'whatsapp';
  perform private.append_audit_event(
    target_tenant_id, 'staff', target_staff_id, 'messaging.disconnected',
    'WhatsApp desconectado', 'messaging:' || gen_random_uuid()::text,
    'location', target_location_id);
  return private.messaging_overview_json(target_tenant_id, target_location_id);
end;
$$;

create or replace function private.upsert_whatsapp_templates(
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
        and candidate.channel = 'whatsapp'
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

create or replace function private.save_messaging_automation(
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
declare
  template_channel text;
begin
  perform private.require_messaging_manager(
    target_tenant_id, target_location_id, target_staff_id);
  if target_kind not in ('reward_earned', 'reward_expiring', 'birthday', 'inactivity') then
    raise exception 'unknown automation' using errcode = 'PT296';
  end if;
  -- The channel of the automation is the channel of its template.
  select template.channel into template_channel from private.whatsapp_templates template
  where template.tenant_id = target_tenant_id and template.location_id = target_location_id
    and template.id = target_template_id and template.approval_status = 'approved';
  if template_channel is null then
    raise exception 'the template is not approved' using errcode = 'PT295';
  end if;
  -- Changing the template always asks for a new approval.
  insert into private.messaging_automations (
    tenant_id, location_id, kind, channel, template_id, status
  ) values (
    target_tenant_id, target_location_id, target_kind, template_channel, target_template_id,
    'pending_approval')
  on conflict (tenant_id, location_id, kind, channel) do update set
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

create or replace function private.propose_one_off_event(
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
  if template.channel = 'whatsapp' and not exists (
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
    template_name, template_language, category, estimated_cost_cents, variables, status, channel
  )
  select target_tenant_id, target_location_id, person, 'one_off', target_command_id,
    'one_off:' || target_command_id::text, template.id, template.name, template.language,
    template.category, template.estimated_cost_cents, target_variables,
    'awaiting_confirmation', template.channel
  from unnest(people) person
  on conflict (tenant_id, profile_id, event_key) do nothing;
  return jsonb_build_object('batchId', target_command_id, 'recipients', total);
end;
$$;

-- 9. Push: the diner's side -----------------------------------------------------------------

create function private.register_push_subscription(
  target_tenant_id uuid,
  target_account_id uuid,
  target_endpoint text,
  target_p256dh text,
  target_auth text
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
begin
  perform private.diner_account_guard(target_account_id);
  own_profile := private.diner_profile_id_of(target_tenant_id, target_account_id);
  if own_profile is null then
    raise exception 'create the profile first' using errcode = 'PT282';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('messaging:' || target_tenant_id::text || own_profile::text, 0));
  begin
    insert into private.push_subscriptions (tenant_id, profile_id, endpoint, p256dh, auth)
    values (target_tenant_id, own_profile, target_endpoint, target_p256dh, target_auth)
    on conflict (endpoint) do update set
      tenant_id = excluded.tenant_id, profile_id = excluded.profile_id,
      p256dh = excluded.p256dh, auth = excluded.auth,
      revoked_at = null, revoked_reason = null, last_seen_at = now();
  exception when check_violation or not_null_violation then
    raise exception 'invalid subscription' using errcode = 'PT297';
  end;
  -- A person keeps their ten most recent browsers.
  update private.push_subscriptions subscription
  set revoked_at = now(), revoked_reason = 'replaced'
  where subscription.tenant_id = target_tenant_id and subscription.profile_id = own_profile
    and subscription.revoked_at is null
    and subscription.id not in (
      select recent.id from private.push_subscriptions recent
      where recent.tenant_id = target_tenant_id and recent.profile_id = own_profile
        and recent.revoked_at is null
      order by recent.last_seen_at desc, recent.id
      limit 10);
  return jsonb_build_object('subscribed', true);
end;
$$;

create function private.revoke_push_subscription(
  target_tenant_id uuid,
  target_account_id uuid,
  target_endpoint text
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
begin
  perform private.diner_account_guard(target_account_id);
  own_profile := private.diner_profile_id_of(target_tenant_id, target_account_id);
  if own_profile is null then
    raise exception 'create the profile first' using errcode = 'PT282';
  end if;
  update private.push_subscriptions subscription
  set revoked_at = now(), revoked_reason = 'diner'
  where subscription.tenant_id = target_tenant_id and subscription.profile_id = own_profile
    and subscription.endpoint = target_endpoint and subscription.revoked_at is null;
  return jsonb_build_object('subscribed', false);
end;
$$;

-- Is THIS browser subscribed? (the endpoint comes from the browser itself)
create function private.push_subscription_state(
  target_tenant_id uuid,
  target_account_id uuid,
  target_endpoint text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set row_security = off
as $$
declare
  own_profile uuid;
begin
  perform private.diner_account_guard(target_account_id);
  own_profile := private.diner_profile_id_of(target_tenant_id, target_account_id);
  return jsonb_build_object('subscribed', own_profile is not null and exists (
    select 1 from private.push_subscriptions subscription
    where subscription.tenant_id = target_tenant_id and subscription.profile_id = own_profile
      and subscription.endpoint = target_endpoint and subscription.revoked_at is null));
end;
$$;

-- The push service says the endpoint no longer exists (404/410): stop using it.
create function private.revoke_push_endpoint(target_endpoint text)
returns void
language sql
volatile
security definer
set search_path = ''
set row_security = off
as $$
  update private.push_subscriptions subscription
  set revoked_at = now(), revoked_reason = 'gone'
  where subscription.endpoint = target_endpoint and subscription.revoked_at is null;
$$;

-- 10. Push: the Encargado's side ------------------------------------------------------------

create function private.set_push_sending(
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
  insert into private.push_settings (tenant_id, location_id, sending_enabled)
  values (target_tenant_id, target_location_id, target_enabled)
  on conflict (tenant_id, location_id) do update
  set sending_enabled = excluded.sending_enabled, updated_at = now();
  perform private.append_audit_event(
    target_tenant_id, 'staff', target_staff_id,
    case when target_enabled then 'messaging.push_enabled' else 'messaging.push_disabled' end,
    case when target_enabled then 'Avisos push activados' else 'Avisos push apagados' end,
    'messaging:' || gen_random_uuid()::text, 'location', target_location_id);
  return private.messaging_overview_json(target_tenant_id, target_location_id);
end;
$$;

-- The restaurant writes its own push messages: no Meta approval, so they are approved
-- from the start. Changing the text or the category sends the automations using it back
-- to approval, like a WhatsApp template that Meta changed.
create function private.save_push_template(
  target_tenant_id uuid,
  target_location_id uuid,
  target_staff_id uuid,
  target_name text,
  target_category text,
  target_body text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
declare
  existing private.whatsapp_templates%rowtype;
begin
  perform private.require_messaging_manager(
    target_tenant_id, target_location_id, target_staff_id);
  if target_body is null or length(target_body) not between 1 and 240 then
    raise exception 'invalid push message' using errcode = 'PT297';
  end if;
  begin
    select * into existing from private.whatsapp_templates candidate
    where candidate.tenant_id = target_tenant_id and candidate.location_id = target_location_id
      and candidate.channel = 'web_push' and candidate.name = target_name
      and candidate.language = 'es'
    for update;
    if found then
      update private.whatsapp_templates
      set category = target_category, body = target_body, synced_at = now()
      where tenant_id = target_tenant_id and id = existing.id;
      if existing.body is distinct from target_body
        or existing.category is distinct from target_category
      then
        update private.messaging_automations
        set status = 'pending_approval', approved_by = null, approved_at = null,
            updated_at = now()
        where tenant_id = target_tenant_id and template_id = existing.id
          and status <> 'pending_approval';
      end if;
    else
      insert into private.whatsapp_templates (
        tenant_id, location_id, name, language, category, body, approval_status, channel
      ) values (
        target_tenant_id, target_location_id, target_name, 'es', target_category,
        target_body, 'approved', 'web_push');
    end if;
  exception when check_violation or not_null_violation then
    raise exception 'invalid push message' using errcode = 'PT297';
  end;
  return private.messaging_overview_json(target_tenant_id, target_location_id);
end;
$$;

-- 11. Anonymizing a profile drops its browsers ----------------------------------------------

create function private.on_profile_anonymized_revoke_push()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
begin
  if new.anonymized_at is not null and old.anonymized_at is null then
    update private.push_subscriptions subscription
    set revoked_at = now(), revoked_reason = 'anonymized'
    where subscription.tenant_id = new.tenant_id and subscription.profile_id = new.id
      and subscription.revoked_at is null;
  end if;
  return new;
end;
$$;
create trigger diner_profiles_revoke_push
after update of anonymized_at on private.diner_profiles
for each row execute function private.on_profile_anonymized_revoke_push();

-- 12. Privileges ----------------------------------------------------------------------------

revoke all on function
  private.push_active(uuid, uuid),
  private.messaging_channel_ok(uuid, uuid, text, text),
  private.register_push_subscription(uuid, uuid, text, text, text),
  private.revoke_push_subscription(uuid, uuid, text),
  private.push_subscription_state(uuid, uuid, text),
  private.revoke_push_endpoint(text),
  private.set_push_sending(uuid, uuid, uuid, boolean),
  private.save_push_template(uuid, uuid, uuid, text, text, text),
  private.on_profile_anonymized_revoke_push()
from public, anon, authenticated, authenticator;
grant execute on function
  private.register_push_subscription(uuid, uuid, text, text, text),
  private.revoke_push_subscription(uuid, uuid, text),
  private.push_subscription_state(uuid, uuid, text),
  private.revoke_push_endpoint(text),
  private.set_push_sending(uuid, uuid, uuid, boolean),
  private.save_push_template(uuid, uuid, uuid, text, text, text)
to authenticator;

commit;
