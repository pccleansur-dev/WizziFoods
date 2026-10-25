begin;

-- T29: verified daily visits, birthday and personal rewards with atomic redemption.
-- Everything hangs from private.diner_profiles (per restaurant, opaque id) and from
-- private.diner_session_links (the SESSION, never the table). table_sessions and
-- account_entries gain no columns. Error codes: PT287-PT292.

-- 1. Settings (one row per location; no row = loyalty off) --------------------------------

create table private.loyalty_settings (
  tenant_id uuid not null,
  location_id uuid not null,
  enabled boolean not null default false,
  min_spend_cents integer not null default 0 check (min_spend_cents between 0 and 1000000000),
  min_session_minutes integer not null default 0 check (min_session_minutes between 0 and 720),
  visits_goal integer not null default 5 check (visits_goal between 1 and 50),
  reward_kind text not null default 'percent' check (reward_kind in ('amount', 'percent')),
  reward_value integer not null default 1000 check (reward_value > 0),
  reward_valid_days integer not null default 90 check (reward_valid_days between 1 and 730),
  reservation_minutes integer not null default 30 check (reservation_minutes between 1 and 240),
  birthday_min_age_days integer not null default 30 check (birthday_min_age_days between 0 and 3650),
  birthday_max_changes integer not null default 1 check (birthday_max_changes between 0 and 10),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, location_id),
  foreign key (tenant_id, location_id)
    references public.locations(tenant_id, id) on delete cascade,
  check (reward_kind <> 'percent' or reward_value <= 10000)
);

-- 2. Rewards ---------------------------------------------------------------------------------

create table private.loyalty_rewards (
  id uuid not null default gen_random_uuid(),
  tenant_id uuid not null,
  location_id uuid not null,
  profile_id uuid not null,
  reward_kind text not null check (reward_kind in ('amount', 'percent')),
  reward_value integer not null check (reward_value > 0),
  status text not null default 'available'
    check (status in ('available', 'reserved', 'redeemed', 'revoked')),
  granted_at timestamptz not null default now(),
  expires_at timestamptz not null,
  reserved_session_id uuid,
  reserved_at timestamptz,
  reserve_expires_at timestamptz,
  redeemed_at timestamptz,
  redeemed_cents integer check (redeemed_cents > 0),
  primary key (tenant_id, id),
  foreign key (tenant_id, profile_id)
    references private.diner_profiles(tenant_id, id) on delete cascade,
  foreign key (tenant_id, location_id, reserved_session_id)
    references private.table_sessions(tenant_id, location_id, id) on delete restrict,
  check ((status = 'reserved') = (reserved_session_id is not null)),
  check ((status = 'reserved') = (reserve_expires_at is not null)),
  check ((status = 'redeemed') = (redeemed_at is not null))
);
create index loyalty_rewards_profile_idx
  on private.loyalty_rewards (tenant_id, profile_id, status);
create unique index loyalty_rewards_one_reserved_per_session_idx
  on private.loyalty_rewards (tenant_id, reserved_session_id)
  where status = 'reserved';

create trigger loyalty_rewards_no_delete
before delete on private.loyalty_rewards
for each row execute function private.reject_append_only_change();
create trigger loyalty_rewards_no_truncate
before truncate on private.loyalty_rewards
for each statement execute function private.reject_append_only_change();

-- 3. Visits -----------------------------------------------------------------------------------

create table private.loyalty_visits (
  id uuid not null default gen_random_uuid(),
  tenant_id uuid not null,
  location_id uuid not null,
  profile_id uuid not null,
  session_id uuid not null,
  -- The calendar day in the location's own time zone, taken when the session opened.
  local_day date not null,
  net_cents integer not null check (net_cents > 0),
  status text not null default 'credited' check (status in ('credited', 'revoked')),
  reward_id uuid,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (tenant_id, id),
  foreign key (tenant_id, profile_id)
    references private.diner_profiles(tenant_id, id) on delete cascade,
  foreign key (tenant_id, location_id, session_id)
    references private.table_sessions(tenant_id, location_id, id) on delete restrict,
  foreign key (tenant_id, reward_id)
    references private.loyalty_rewards(tenant_id, id) on delete restrict,
  check ((status = 'revoked') = (revoked_at is not null))
);
-- At most one live visit per person, restaurant and local day.
create unique index loyalty_visits_one_per_day_idx
  on private.loyalty_visits (tenant_id, profile_id, local_day)
  where status = 'credited';
-- A session credits a person once, even if it is revoked later.
create unique index loyalty_visits_one_per_session_idx
  on private.loyalty_visits (tenant_id, session_id, profile_id);
create index loyalty_visits_profile_idx
  on private.loyalty_visits (tenant_id, profile_id, status, created_at);

create function private.guard_loyalty_visit_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  movable constant text[] := array['status', 'revoked_at', 'reward_id'];
begin
  if tg_op <> 'UPDATE'
    or (to_jsonb(new) - movable) is distinct from (to_jsonb(old) - movable)
    or (old.status = 'revoked' and new.status <> 'revoked')
  then
    raise exception 'a visit is never deleted or rewritten' using errcode = 'PT209';
  end if;
  return new;
end;
$$;
create trigger loyalty_visits_guard_change
before update or delete on private.loyalty_visits
for each row execute function private.guard_loyalty_visit_change();
create trigger loyalty_visits_no_truncate
before truncate on private.loyalty_visits
for each statement execute function private.reject_append_only_change();

-- 4. Birthday ---------------------------------------------------------------------------------

-- Only month and day are kept: the year is never asked for.
create table private.diner_birthdays (
  tenant_id uuid not null,
  profile_id uuid not null,
  birth_month integer not null check (birth_month between 1 and 12),
  birth_day integer not null check (birth_day between 1 and 31),
  changes integer not null default 0 check (changes >= 0),
  set_at timestamptz not null default now(),
  primary key (tenant_id, profile_id),
  foreign key (tenant_id, profile_id)
    references private.diner_profiles(tenant_id, id) on delete cascade
);

revoke all on table
  private.loyalty_settings, private.loyalty_rewards, private.loyalty_visits,
  private.diner_birthdays
from public, anon, authenticated, authenticator;

-- 5. Helpers ----------------------------------------------------------------------------------

create function private.loyalty_local_day(target_location_id uuid, moment timestamptz)
returns date
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select (moment at time zone location.timezone)::date
  from public.locations location
  where location.id = target_location_id;
$$;

create function private.loyalty_reward_cents(
  reward private.loyalty_rewards,
  pending integer
)
returns integer
language sql
immutable
set search_path = ''
as $$
  select greatest(0, least(pending, case reward.reward_kind
    when 'amount' then reward.reward_value
    else private.discount_cents_for_percent(pending, reward.reward_value)
  end));
$$;

-- Reservations that were never paid expire on their own.
create function private.release_expired_rewards(target_tenant_id uuid, target_profile_id uuid)
returns void
language sql
volatile
security definer
set search_path = ''
set row_security = off
as $$
  update private.loyalty_rewards reward
  set status = 'available', reserved_session_id = null,
      reserved_at = null, reserve_expires_at = null
  where reward.tenant_id = target_tenant_id
    and (target_profile_id is null or reward.profile_id = target_profile_id)
    and reward.status = 'reserved'
    and reward.reserve_expires_at <= now();
$$;

-- Turns every `visits_goal` unassigned visits of a person into a reward.
create function private.grant_loyalty_rewards(
  target_tenant_id uuid,
  target_location_id uuid,
  target_profile_id uuid
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
declare
  settings private.loyalty_settings%rowtype;
  granted integer := 0;
  new_reward_id uuid;
begin
  select * into settings from private.loyalty_settings setting
  where setting.tenant_id = target_tenant_id and setting.location_id = target_location_id;
  if not found or not settings.enabled then
    return 0;
  end if;
  loop
    exit when (
      select count(*) from private.loyalty_visits visit
      where visit.tenant_id = target_tenant_id and visit.profile_id = target_profile_id
        and visit.status = 'credited' and visit.reward_id is null
    ) < settings.visits_goal;
    new_reward_id := gen_random_uuid();
    insert into private.loyalty_rewards (
      id, tenant_id, location_id, profile_id, reward_kind, reward_value, expires_at
    ) values (
      new_reward_id, target_tenant_id, target_location_id, target_profile_id,
      settings.reward_kind, settings.reward_value,
      now() + make_interval(days => settings.reward_valid_days)
    );
    update private.loyalty_visits visit
    set reward_id = new_reward_id
    where visit.tenant_id = target_tenant_id
      and visit.id in (
        select oldest.id from private.loyalty_visits oldest
        where oldest.tenant_id = target_tenant_id and oldest.profile_id = target_profile_id
          and oldest.status = 'credited' and oldest.reward_id is null
        order by oldest.created_at, oldest.id
        limit settings.visits_goal
      );
    granted := granted + 1;
  end loop;
  return granted;
end;
$$;

-- 6. Crediting visits when an account closes ------------------------------------------------

create function private.credit_session_visits(
  target_tenant_id uuid,
  target_location_id uuid,
  target_session_id uuid
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
declare
  settings private.loyalty_settings%rowtype;
  account_session private.table_sessions%rowtype;
  summary jsonb;
  net integer;
  linked integer;
  share integer;
  credited integer := 0;
  person record;
  inserted integer;
begin
  select * into settings from private.loyalty_settings setting
  where setting.tenant_id = target_tenant_id and setting.location_id = target_location_id;
  if not found or not settings.enabled then
    return 0;
  end if;
  select * into account_session from private.table_sessions s
  where s.tenant_id = target_tenant_id and s.location_id = target_location_id
    and s.id = target_session_id and s.status = 'closed';
  if not found then
    return 0;
  end if;
  -- Too short a stay is not a visit.
  if account_session.closed_at - account_session.opened_at
    < make_interval(mins => settings.min_session_minutes)
  then
    return 0;
  end if;
  summary := private.account_summary(target_tenant_id, target_location_id, target_session_id);
  -- What was really consumed, after discounts; refunded accounts earn nothing.
  net := (summary ->> 'consumedCents')::integer - (summary ->> 'discountCents')::integer;
  if net <= 0 or (summary ->> 'refundedCents')::integer > 0 then
    return 0;
  end if;
  select count(*) into linked
  from private.diner_session_links link
  join private.diner_profiles profile
    on profile.tenant_id = link.tenant_id and profile.id = link.profile_id
  where link.tenant_id = target_tenant_id and link.location_id = target_location_id
    and link.session_id = target_session_id and profile.anonymized_at is null;
  if linked = 0 then
    return 0;
  end if;
  -- A group account is shared in equal parts among the linked people.
  share := net / linked;
  if share <= 0 or share < settings.min_spend_cents then
    return 0;
  end if;
  for person in
    select link.profile_id
    from private.diner_session_links link
    join private.diner_profiles profile
      on profile.tenant_id = link.tenant_id and profile.id = link.profile_id
    where link.tenant_id = target_tenant_id and link.location_id = target_location_id
      and link.session_id = target_session_id and profile.anonymized_at is null
    order by link.profile_id
  loop
    -- Serialize every credit of the same person; the unique index is the last guard.
    perform pg_advisory_xact_lock(
      hashtextextended('loyalty:' || target_tenant_id::text || person.profile_id::text, 0));
    insert into private.loyalty_visits (
      tenant_id, location_id, profile_id, session_id, local_day, net_cents
    ) values (
      target_tenant_id, target_location_id, person.profile_id, target_session_id,
      private.loyalty_local_day(target_location_id, account_session.opened_at), share
    )
    on conflict do nothing;
    get diagnostics inserted = row_count;
    if inserted > 0 then
      credited := credited + 1;
      perform private.grant_loyalty_rewards(
        target_tenant_id, target_location_id, person.profile_id);
    end if;
  end loop;
  return credited;
end;
$$;

-- Closing never waits for or fails because of loyalty.
create function private.on_session_closed_credit_visits()
returns trigger
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
begin
  begin
    perform private.credit_session_visits(new.tenant_id, new.location_id, new.id);
  exception when others then
    null;
  end;
  return null;
end;
$$;
create trigger table_sessions_credit_visits
after update of status on private.table_sessions
for each row when (old.status = 'open' and new.status = 'closed')
execute function private.on_session_closed_credit_visits();

-- A total refund revokes the visits of that session (and the rewards they unlocked).
create function private.revoke_session_visits(
  target_tenant_id uuid,
  target_location_id uuid,
  target_session_id uuid
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
declare
  summary jsonb := private.account_summary(
    target_tenant_id, target_location_id, target_session_id);
  revoked integer;
  affected record;
begin
  if (summary ->> 'paidCents')::integer <= 0
    or (summary ->> 'refundedCents')::integer < (summary ->> 'paidCents')::integer
  then
    return 0;
  end if;
  for affected in
    select visit.id, visit.profile_id, visit.reward_id
    from private.loyalty_visits visit
    where visit.tenant_id = target_tenant_id and visit.session_id = target_session_id
      and visit.status = 'credited'
    order by visit.profile_id
    for update
  loop
    update private.loyalty_visits
    set status = 'revoked', revoked_at = now()
    where tenant_id = target_tenant_id and id = affected.id;
    if affected.reward_id is not null then
      -- An unused reward goes away with the visit; a redeemed one stays as it was.
      update private.loyalty_rewards reward
      set status = 'revoked', reserved_session_id = null,
          reserved_at = null, reserve_expires_at = null
      where reward.tenant_id = target_tenant_id and reward.id = affected.reward_id
        and reward.status in ('available', 'reserved');
      -- The other visits that built it count again.
      update private.loyalty_visits other
      set reward_id = null
      where other.tenant_id = target_tenant_id and other.reward_id = affected.reward_id
        and other.status = 'credited'
        and exists (select 1 from private.loyalty_rewards gone
          where gone.tenant_id = target_tenant_id and gone.id = affected.reward_id
            and gone.status = 'revoked');
    end if;
  end loop;
  get diagnostics revoked = row_count;
  return revoked;
end;
$$;

create function private.on_refund_revoke_visits()
returns trigger
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
begin
  perform private.revoke_session_visits(new.tenant_id, new.location_id, new.session_id);
  return null;
end;
$$;
create trigger account_entries_revoke_visits
after insert on private.account_entries
for each row when (new.kind = 'refund')
execute function private.on_refund_revoke_visits();

-- 7. Settings ---------------------------------------------------------------------------------

create function private.loyalty_settings_json(target_tenant_id uuid, target_location_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select jsonb_build_object(
    'enabled', coalesce(setting.enabled, false),
    'minSpendCents', coalesce(setting.min_spend_cents, 0),
    'minSessionMinutes', coalesce(setting.min_session_minutes, 0),
    'visitsGoal', coalesce(setting.visits_goal, 5),
    'rewardKind', coalesce(setting.reward_kind, 'percent'),
    'rewardValue', coalesce(setting.reward_value, 1000),
    'rewardValidDays', coalesce(setting.reward_valid_days, 90),
    'reservationMinutes', coalesce(setting.reservation_minutes, 30),
    'birthdayMinAgeDays', coalesce(setting.birthday_min_age_days, 30),
    'birthdayMaxChanges', coalesce(setting.birthday_max_changes, 1)
  )
  from (select 1) base
  left join private.loyalty_settings setting
    on setting.tenant_id = target_tenant_id and setting.location_id = target_location_id;
$$;

create function private.get_loyalty_settings(
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
  if private.waiter_actor_role(target_tenant_id, target_location_id, target_staff_id)
    <> 'manager'
  then
    raise exception 'only a manager can read the loyalty program' using errcode = 'PT222';
  end if;
  return private.loyalty_settings_json(target_tenant_id, target_location_id);
end;
$$;

create function private.save_loyalty_settings(
  target_tenant_id uuid,
  target_location_id uuid,
  target_staff_id uuid,
  target_settings jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
begin
  if private.waiter_actor_role(target_tenant_id, target_location_id, target_staff_id)
    <> 'manager'
  then
    raise exception 'only a manager can change the loyalty program' using errcode = 'PT222';
  end if;
  begin
    insert into private.loyalty_settings (
      tenant_id, location_id, enabled, min_spend_cents, min_session_minutes,
      visits_goal, reward_kind, reward_value, reward_valid_days, reservation_minutes,
      birthday_min_age_days, birthday_max_changes, updated_at
    ) values (
      target_tenant_id, target_location_id,
      (target_settings ->> 'enabled')::boolean,
      (target_settings ->> 'minSpendCents')::integer,
      (target_settings ->> 'minSessionMinutes')::integer,
      (target_settings ->> 'visitsGoal')::integer,
      target_settings ->> 'rewardKind',
      (target_settings ->> 'rewardValue')::integer,
      (target_settings ->> 'rewardValidDays')::integer,
      (target_settings ->> 'reservationMinutes')::integer,
      (target_settings ->> 'birthdayMinAgeDays')::integer,
      (target_settings ->> 'birthdayMaxChanges')::integer,
      now()
    )
    on conflict (tenant_id, location_id) do update set
      enabled = excluded.enabled,
      min_spend_cents = excluded.min_spend_cents,
      min_session_minutes = excluded.min_session_minutes,
      visits_goal = excluded.visits_goal,
      reward_kind = excluded.reward_kind,
      reward_value = excluded.reward_value,
      reward_valid_days = excluded.reward_valid_days,
      reservation_minutes = excluded.reservation_minutes,
      birthday_min_age_days = excluded.birthday_min_age_days,
      birthday_max_changes = excluded.birthday_max_changes,
      updated_at = now();
  exception when check_violation or not_null_violation or invalid_text_representation
    or numeric_value_out_of_range
  then
    raise exception 'invalid loyalty settings' using errcode = 'PT291';
  end;
  perform private.append_audit_event(
    target_tenant_id, 'staff', target_staff_id, 'loyalty.settings_saved',
    'Programa de fidelización actualizado', 'loyalty:' || gen_random_uuid()::text,
    'location', target_location_id
  );
  return private.loyalty_settings_json(target_tenant_id, target_location_id);
end;
$$;

-- 8. What the diner sees --------------------------------------------------------------------

create function private.loyalty_birthday_json(target_tenant_id uuid, target_profile_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select coalesce((
    select jsonb_build_object('month', birthday.birth_month, 'day', birthday.birth_day,
      'changes', birthday.changes)
    from private.diner_birthdays birthday
    where birthday.tenant_id = target_tenant_id and birthday.profile_id = target_profile_id
  ), 'null'::jsonb);
$$;

create function private.get_diner_loyalty(
  target_tenant_id uuid,
  target_location_id uuid,
  target_account_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
declare
  own_profile_id uuid;
  settings jsonb := private.loyalty_settings_json(target_tenant_id, target_location_id);
begin
  perform private.diner_account_guard(target_account_id);
  own_profile_id := private.diner_profile_id_of(target_tenant_id, target_account_id);
  if own_profile_id is null then
    raise exception 'create the profile first' using errcode = 'PT282';
  end if;
  perform private.release_expired_rewards(target_tenant_id, own_profile_id);
  return jsonb_build_object(
    'enabled', (settings ->> 'enabled')::boolean,
    'visitsGoal', (settings ->> 'visitsGoal')::integer,
    'minSpendCents', (settings ->> 'minSpendCents')::integer,
    'rewardKind', settings ->> 'rewardKind',
    'rewardValue', (settings ->> 'rewardValue')::integer,
    'progress', (
      select count(*)::integer from private.loyalty_visits visit
      where visit.tenant_id = target_tenant_id and visit.profile_id = own_profile_id
        and visit.status = 'credited' and visit.reward_id is null),
    'visits', (
      select count(*)::integer from private.loyalty_visits visit
      where visit.tenant_id = target_tenant_id and visit.profile_id = own_profile_id
        and visit.status = 'credited'),
    'rewards', coalesce((
      select jsonb_agg(jsonb_build_object(
        'rewardId', reward.id, 'kind', reward.reward_kind, 'value', reward.reward_value,
        'status', reward.status, 'expiresAt', reward.expires_at,
        'reservedSessionId', reward.reserved_session_id,
        'reserveExpiresAt', reward.reserve_expires_at
      ) order by reward.granted_at, reward.id)
      from private.loyalty_rewards reward
      where reward.tenant_id = target_tenant_id and reward.profile_id = own_profile_id
        and reward.location_id = target_location_id
        and (reward.status in ('available', 'reserved') and reward.expires_at > now())
    ), '[]'::jsonb),
    'birthday', private.loyalty_birthday_json(target_tenant_id, own_profile_id)
  );
end;
$$;

create function private.save_diner_birthday(
  target_tenant_id uuid,
  target_location_id uuid,
  target_account_id uuid,
  target_month integer,
  target_day integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
declare
  own_profile_id uuid;
  profile private.diner_profiles%rowtype;
  settings jsonb := private.loyalty_settings_json(target_tenant_id, target_location_id);
  current_birthday private.diner_birthdays%rowtype;
begin
  perform private.diner_account_guard(target_account_id, true);
  own_profile_id := private.diner_profile_id_of(target_tenant_id, target_account_id);
  if own_profile_id is null then
    raise exception 'create the profile first' using errcode = 'PT282';
  end if;
  -- 29 February is a valid birthday; any other impossible date is not.
  if target_month is null or target_day is null
    or target_month not between 1 and 12 or target_day not between 1 and 31
    or (target_month = 2 and target_day > 29)
    or (target_month in (4, 6, 9, 11) and target_day > 30)
  then
    raise exception 'invalid birthday' using errcode = 'PT291';
  end if;
  select * into profile from private.diner_profiles p
  where p.tenant_id = target_tenant_id and p.id = own_profile_id for update;
  if profile.created_at > now()
    - make_interval(days => (settings ->> 'birthdayMinAgeDays')::integer)
  then
    raise exception 'the profile is too new to set a birthday' using errcode = 'PT288';
  end if;
  select * into current_birthday from private.diner_birthdays birthday
  where birthday.tenant_id = target_tenant_id and birthday.profile_id = own_profile_id
  for update;
  if not found then
    insert into private.diner_birthdays (tenant_id, profile_id, birth_month, birth_day)
    values (target_tenant_id, own_profile_id, target_month, target_day);
  elsif current_birthday.birth_month = target_month and current_birthday.birth_day = target_day then
    null;
  else
    if current_birthday.changes >= (settings ->> 'birthdayMaxChanges')::integer then
      raise exception 'the birthday cannot be changed again' using errcode = 'PT289';
    end if;
    update private.diner_birthdays birthday
    set birth_month = target_month, birth_day = target_day,
        changes = birthday.changes + 1, set_at = now()
    where birthday.tenant_id = target_tenant_id and birthday.profile_id = own_profile_id;
  end if;
  return private.loyalty_birthday_json(target_tenant_id, own_profile_id);
end;
$$;

-- 9. Reserving, releasing and redeeming a reward --------------------------------------------

-- The diner holds a reward for the account they are sitting at. Nothing is charged yet.
create function private.reserve_loyalty_reward(
  target_tenant_id uuid,
  target_location_id uuid,
  target_account_id uuid,
  target_reward_id uuid,
  target_session_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
declare
  settings private.loyalty_settings%rowtype;
  own_profile_id uuid;
  reward private.loyalty_rewards%rowtype;
  pending integer;
  discount integer;
begin
  perform private.diner_account_guard(target_account_id);
  own_profile_id := private.diner_profile_id_of(target_tenant_id, target_account_id);
  if own_profile_id is null then
    raise exception 'create the profile first' using errcode = 'PT282';
  end if;
  select * into settings from private.loyalty_settings setting
  where setting.tenant_id = target_tenant_id and setting.location_id = target_location_id;
  if not found or not settings.enabled then
    raise exception 'the loyalty program is off' using errcode = 'PT287';
  end if;
  -- The account first (the order every payment path uses), then the reward.
  perform 1 from private.table_sessions account_session
  where account_session.tenant_id = target_tenant_id
    and account_session.location_id = target_location_id
    and account_session.id = target_session_id and account_session.status = 'open'
    and exists (
      select 1 from private.diner_session_links link
      where link.tenant_id = target_tenant_id and link.location_id = target_location_id
        and link.session_id = target_session_id and link.profile_id = own_profile_id)
  for update;
  if not found then
    raise exception 'the account is not available for this diner' using errcode = 'PT292';
  end if;
  perform private.release_expired_rewards(target_tenant_id, own_profile_id);
  select * into reward from private.loyalty_rewards candidate
  where candidate.tenant_id = target_tenant_id and candidate.id = target_reward_id
    and candidate.profile_id = own_profile_id and candidate.location_id = target_location_id
  for update;
  if not found or reward.status <> 'available' or reward.expires_at <= now() then
    raise exception 'the reward is not available' using errcode = 'PT290';
  end if;
  pending := (private.account_summary(
    target_tenant_id, target_location_id, target_session_id) ->> 'pendingCents')::integer;
  discount := private.loyalty_reward_cents(reward, pending);
  if discount <= 0 then
    raise exception 'there is nothing to discount' using errcode = 'PT292';
  end if;
  begin
    update private.loyalty_rewards
    set status = 'reserved', reserved_session_id = target_session_id, reserved_at = now(),
        reserve_expires_at = now() + make_interval(mins => settings.reservation_minutes)
    where tenant_id = target_tenant_id and id = target_reward_id;
  exception when unique_violation then
    raise exception 'the account already has a reward reserved' using errcode = 'PT290';
  end;
  return jsonb_build_object(
    'rewardId', target_reward_id, 'sessionId', target_session_id,
    'discountCents', discount, 'pendingCents', pending - discount);
end;
$$;

create function private.release_loyalty_reward(
  target_tenant_id uuid,
  target_location_id uuid,
  target_account_id uuid,
  target_reward_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
declare
  own_profile_id uuid;
  released integer;
begin
  perform private.diner_account_guard(target_account_id);
  own_profile_id := private.diner_profile_id_of(target_tenant_id, target_account_id);
  if own_profile_id is null then
    raise exception 'create the profile first' using errcode = 'PT282';
  end if;
  update private.loyalty_rewards reward
  set status = 'available', reserved_session_id = null,
      reserved_at = null, reserve_expires_at = null
  where reward.tenant_id = target_tenant_id and reward.id = target_reward_id
    and reward.profile_id = own_profile_id and reward.location_id = target_location_id
    and reward.status = 'reserved';
  get diagnostics released = row_count;
  return jsonb_build_object('rewardId', target_reward_id, 'released', released > 0);
end;
$$;

-- The reward a diner holds at an account, for the waiter to apply at the till.
create function private.session_loyalty_rewards(
  target_tenant_id uuid,
  target_location_id uuid,
  target_staff_id uuid,
  target_session_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_role text := private.waiter_actor_role(
    target_tenant_id, target_location_id, target_staff_id);
  pending integer;
begin
  if not private.waiter_serves_session(
    target_tenant_id, target_location_id, target_staff_id, actor_role, target_session_id)
  then
    raise exception 'account not found' using errcode = 'PT201';
  end if;
  perform private.release_expired_rewards(target_tenant_id, null);
  pending := (private.account_summary(
    target_tenant_id, target_location_id, target_session_id) ->> 'pendingCents')::integer;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'rewardId', reward.id, 'displayName', profile.display_name,
      'kind', reward.reward_kind, 'value', reward.reward_value,
      'discountCents', private.loyalty_reward_cents(reward, pending),
      'reserveExpiresAt', reward.reserve_expires_at
    ) order by reward.reserved_at, reward.id)
    from private.loyalty_rewards reward
    join private.diner_profiles profile
      on profile.tenant_id = reward.tenant_id and profile.id = reward.profile_id
    where reward.tenant_id = target_tenant_id and reward.location_id = target_location_id
      and reward.reserved_session_id = target_session_id and reward.status = 'reserved'
  ), '[]'::jsonb);
end;
$$;

-- Reserve + discount + payment + redemption in ONE transaction. If the payment cannot
-- be recorded, nothing is written and the reward is released for the diner.
create function private.redeem_loyalty_reward_with_payment(
  target_tenant_id uuid,
  target_location_id uuid,
  target_staff_id uuid,
  target_command_id uuid,
  target_session_id uuid,
  target_reward_id uuid,
  target_method text,
  target_tip_cents integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_role text := private.waiter_actor_role(
    target_tenant_id, target_location_id, target_staff_id);
  stored jsonb;
  reward private.loyalty_rewards%rowtype;
  pending integer;
  discount integer;
  payment jsonb;
  failure text;
begin
  if not private.waiter_serves_session(
    target_tenant_id, target_location_id, target_staff_id, actor_role, target_session_id)
  then
    raise exception 'account not found' using errcode = 'PT201';
  end if;
  stored := private.claim_waiter_command(
    target_tenant_id, target_location_id, target_staff_id, target_command_id,
    jsonb_build_object(
      'kind', 'loyalty_redeem', 'sessionId', target_session_id,
      'rewardId', target_reward_id, 'method', target_method, 'tip', target_tip_cents)
  );
  if stored is not null then
    return stored;
  end if;
  -- Same order as every payment: the account first, then the reward.
  perform 1 from private.table_sessions account_session
  where account_session.tenant_id = target_tenant_id
    and account_session.location_id = target_location_id
    and account_session.id = target_session_id and account_session.status = 'open'
  for update;
  if not found then
    raise exception 'account not found' using errcode = 'PT201';
  end if;
  select * into reward from private.loyalty_rewards candidate
  where candidate.tenant_id = target_tenant_id and candidate.id = target_reward_id
    and candidate.location_id = target_location_id
  for update;
  if not found or reward.status <> 'reserved'
    or reward.reserved_session_id is distinct from target_session_id
    or reward.reserve_expires_at <= now() or reward.expires_at <= now()
  then
    raise exception 'the reward is not reserved for this account' using errcode = 'PT290';
  end if;
  pending := (private.account_summary(
    target_tenant_id, target_location_id, target_session_id) ->> 'pendingCents')::integer;
  discount := private.loyalty_reward_cents(reward, pending);
  if discount <= 0 then
    raise exception 'there is nothing to discount' using errcode = 'PT292';
  end if;

  begin
    insert into private.account_entries (
      tenant_id, location_id, session_id, kind, amount_cents, origin, cause,
      source_type, source_id, actor_type, actor_id, command_id
    ) values (
      target_tenant_id, target_location_id, target_session_id, 'discount',
      -discount, 'discount', 'Premio de fidelización', 'discount',
      reward.id, 'staff', target_staff_id, target_command_id
    );
    if pending - discount > 0 then
      payment := private.record_account_payment(
        target_tenant_id, target_location_id, target_staff_id,
        md5(target_command_id::text || ':loyalty-payment')::uuid,
        target_session_id, target_method, null, coalesce(target_tip_cents, 0));
    end if;
    update private.loyalty_rewards
    set status = 'redeemed', redeemed_at = now(), redeemed_cents = discount,
        reserved_session_id = null, reserved_at = null, reserve_expires_at = null
    where tenant_id = target_tenant_id and id = target_reward_id;
  exception when others then
    get stacked diagnostics failure = returned_sqlstate;
    -- The discount and the payment were rolled back with this block; hand the reward back.
    update private.loyalty_rewards
    set status = 'available', reserved_session_id = null,
        reserved_at = null, reserve_expires_at = null
    where tenant_id = target_tenant_id and id = target_reward_id;
    return private.finish_waiter_command(
      target_tenant_id, target_location_id, target_staff_id, target_command_id,
      jsonb_build_object(
        'sessionId', target_session_id, 'rewardId', target_reward_id,
        'redeemed', false, 'released', true, 'failure', failure));
  end;
  perform private.append_audit_event(
    target_tenant_id, 'staff', target_staff_id, 'loyalty.reward_redeemed',
    'Premio de fidelización canjeado', 'loyalty:' || gen_random_uuid()::text,
    'table_session', target_session_id
  );
  return private.finish_waiter_command(
    target_tenant_id, target_location_id, target_staff_id, target_command_id,
    jsonb_build_object(
      'sessionId', target_session_id, 'rewardId', target_reward_id,
      'redeemed', true, 'released', false, 'discountCents', discount,
      'pendingCents', (private.account_summary(
        target_tenant_id, target_location_id, target_session_id) ->> 'pendingCents')::integer));
end;
$$;

-- 10. Privileges ------------------------------------------------------------------------------

revoke all on function
  private.loyalty_local_day(uuid, timestamptz),
  private.loyalty_reward_cents(private.loyalty_rewards, integer),
  private.release_expired_rewards(uuid, uuid),
  private.grant_loyalty_rewards(uuid, uuid, uuid),
  private.credit_session_visits(uuid, uuid, uuid),
  private.on_session_closed_credit_visits(),
  private.revoke_session_visits(uuid, uuid, uuid),
  private.on_refund_revoke_visits(),
  private.loyalty_settings_json(uuid, uuid),
  private.get_loyalty_settings(uuid, uuid, uuid),
  private.save_loyalty_settings(uuid, uuid, uuid, jsonb),
  private.loyalty_birthday_json(uuid, uuid),
  private.get_diner_loyalty(uuid, uuid, uuid),
  private.save_diner_birthday(uuid, uuid, uuid, integer, integer),
  private.reserve_loyalty_reward(uuid, uuid, uuid, uuid, uuid),
  private.release_loyalty_reward(uuid, uuid, uuid, uuid),
  private.session_loyalty_rewards(uuid, uuid, uuid, uuid),
  private.redeem_loyalty_reward_with_payment(uuid, uuid, uuid, uuid, uuid, uuid, text, integer)
from public, anon, authenticated, authenticator;
grant execute on function
  private.get_loyalty_settings(uuid, uuid, uuid),
  private.save_loyalty_settings(uuid, uuid, uuid, jsonb),
  private.get_diner_loyalty(uuid, uuid, uuid),
  private.save_diner_birthday(uuid, uuid, uuid, integer, integer),
  private.reserve_loyalty_reward(uuid, uuid, uuid, uuid, uuid),
  private.release_loyalty_reward(uuid, uuid, uuid, uuid),
  private.session_loyalty_rewards(uuid, uuid, uuid, uuid),
  private.redeem_loyalty_reward_with_payment(uuid, uuid, uuid, uuid, uuid, uuid, text, integer)
to authenticator;

commit;
