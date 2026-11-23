begin;

create table private.order_service_hours (
  tenant_id uuid not null,
  location_id uuid not null,
  days jsonb not null check (jsonb_typeof(days) = 'array' and jsonb_array_length(days) = 7),
  warning_minutes integer not null check (warning_minutes between 0 and 120),
  paused boolean not null default false,
  primary key (tenant_id, location_id),
  foreign key (tenant_id, location_id) references public.locations(tenant_id, id) on delete cascade
);

revoke all on private.order_service_hours from public, anon, authenticated, authenticator;

create function private.admin_order_hours(
  target_tenant uuid, target_location uuid, requester uuid, settings jsonb default null
) returns jsonb language plpgsql security definer set search_path = '' set row_security = off as $$
declare
  day jsonb;
  cutoff text;
  outcome jsonb;
begin
  perform private.require_floor_plan_admin(target_tenant, target_location, requester);
  if settings is not null then
    if jsonb_typeof(settings->'days') is distinct from 'array'
      or jsonb_array_length(settings->'days') <> 7
      or jsonb_typeof(settings->'paused') is distinct from 'boolean'
      or (settings->>'warningMinutes') is null
      or (settings->>'warningMinutes') !~ '^[0-9]{1,3}$'
      or (settings->>'warningMinutes')::integer > 120
    then raise exception 'invalid order hours' using errcode = '22023'; end if;
    for day in select value from jsonb_array_elements(settings->'days') loop
      if day = 'null'::jsonb then continue; end if;
      if jsonb_typeof(day) is distinct from 'object'
        or coalesce(day->>'opens', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        or coalesce(day->>'orders', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        or day->>'opens' = day->>'orders'
      then raise exception 'invalid service day' using errcode = '22023'; end if;
      foreach cutoff in array array[day->>'kitchen', day->>'bar'] loop
        if cutoff is not null and cutoff !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        then raise exception 'invalid sector cutoff' using errcode = '22023'; end if;
      end loop;
    end loop;
    insert into private.order_service_hours (tenant_id, location_id, days, warning_minutes, paused)
    values (target_tenant, target_location, settings->'days', (settings->>'warningMinutes')::integer, (settings->>'paused')::boolean)
    on conflict (tenant_id, location_id) do update
    set days=excluded.days, warning_minutes=excluded.warning_minutes, paused=excluded.paused;
  end if;
  select jsonb_build_object('days', hours.days, 'warningMinutes', hours.warning_minutes, 'paused', hours.paused)
  into outcome from private.order_service_hours hours
  where (hours.tenant_id, hours.location_id)=(target_tenant, target_location);
  return coalesce(outcome, '{"days":[null,null,null,null,null,null,null],"warningMinutes":15,"paused":false}'::jsonb);
end
$$;

create function private.order_hours_status(
  target_tenant uuid, target_location uuid, at_time timestamptz default statement_timestamp()
) returns jsonb language plpgsql stable security definer set search_path = '' set row_security = off as $$
declare
  settings private.order_service_hours%rowtype;
  local_now timestamp;
  service_date date;
  day jsonb;
  opens_at timestamp;
  ends_at timestamp;
  sector_end timestamp;
  cutoff text;
  sector text;
  result jsonb := '{"ordersClosed":false,"kitchenClosed":false,"barClosed":false}'::jsonb;
  remaining integer;
begin
  select * into settings from private.order_service_hours hours
  where (hours.tenant_id, hours.location_id)=(target_tenant, target_location);
  if not found then return result; end if;
  if settings.paused then return result || '{"ordersClosed":true}'::jsonb; end if;
  if settings.days = '[null,null,null,null,null,null,null]'::jsonb then return result; end if;
  select at_time at time zone location.timezone into strict local_now
  from public.locations location where (location.tenant_id, location.id)=(target_tenant, target_location);

  for day_offset in 0..1 loop
    service_date := local_now::date - day_offset;
    day := settings.days -> (extract(isodow from service_date)::int - 1);
    if day = 'null'::jsonb then continue; end if;
    opens_at := service_date + (day->>'opens')::time;
    ends_at := service_date + (day->>'orders')::time;
    if ends_at < opens_at then ends_at := ends_at + interval '1 day'; end if;
    if local_now < opens_at or local_now >= ends_at then continue; end if;

    remaining := ceil(extract(epoch from ends_at - local_now) / 60);
    if remaining <= settings.warning_minutes then
      result := result || jsonb_build_object('ordersMinutes', remaining);
    end if;
    foreach sector in array array['kitchen','bar'] loop
      cutoff := day ->> sector;
      if cutoff is null then continue; end if;
      sector_end := service_date + cutoff::time;
      if sector_end < opens_at then sector_end := sector_end + interval '1 day'; end if;
      if local_now >= sector_end then
        result := result || jsonb_build_object(sector || 'Closed', true);
      else
        remaining := ceil(extract(epoch from sector_end - local_now) / 60);
        if sector_end < ends_at and remaining <= settings.warning_minutes then
          result := result || jsonb_build_object(sector || 'Minutes', remaining);
        end if;
      end if;
    end loop;
    return result;
  end loop;
  return result || '{"ordersClosed":true}'::jsonb;
end
$$;

create function private.guard_order_service_hours() returns trigger
language plpgsql security definer set search_path = '' set row_security = off as $$
declare
  availability jsonb := private.order_hours_status(new.tenant_id, new.location_id);
  sector_kind text;
begin
  if availability @> '{"ordersClosed":true}'::jsonb then
    raise exception 'order service closed' using errcode = 'PT180';
  end if;
  if not (availability @> '{"kitchenClosed":true}'::jsonb or availability @> '{"barClosed":true}'::jsonb)
    then return new; end if;
  select sector ->> 'kind' into sector_kind
  from (
    select snapshot from private.published_catalogs
    where (tenant_id, location_id)=(new.tenant_id, new.location_id)
    order by revision desc limit 1
  ) catalog
  cross join lateral jsonb_array_elements(catalog.snapshot->'sectors') sector
  where sector->>'id'=new.production_sector_id::text;
  if sector_kind='kitchen' and availability @> '{"kitchenClosed":true}'::jsonb then
    raise exception 'kitchen closed' using errcode = 'PT181';
  elsif sector_kind='bar' and availability @> '{"barClosed":true}'::jsonb then
    raise exception 'bar closed' using errcode = 'PT182';
  end if;
  return new;
end
$$;

create trigger guard_order_service_hours before insert on private.order_intent_items
for each row execute function private.guard_order_service_hours();

revoke all on function private.admin_order_hours(uuid,uuid,uuid,jsonb),
  private.order_hours_status(uuid,uuid,timestamptz), private.guard_order_service_hours()
from public, anon, authenticated, authenticator;
grant execute on function private.admin_order_hours(uuid,uuid,uuid,jsonb),
  private.order_hours_status(uuid,uuid,timestamptz) to authenticator;

commit;
