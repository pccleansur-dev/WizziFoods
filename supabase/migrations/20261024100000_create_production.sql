begin;

-- Production by sector and item state (T20).
--
-- Confirmed orders and their items are append-only (T19), so the state of each
-- item lives in its own table: one row per confirmed item, created by a trigger
-- the moment the item exists and keyed by the item itself, so a retried
-- confirmation can never produce a second row. Kitchen and Bar staff read only
-- the items of their own sector kind and move them One step at a time:
-- queued -> preparing -> ready. The order status is derived, never stored.
--
-- Delivery, shortages and cancellations (T21) and the account (T22) are not
-- here: nothing in this file moves money or touches a confirmed order.

-- 1. Tables -----------------------------------------------------------------

create table private.production_items (
  tenant_id uuid not null,
  location_id uuid not null,
  order_id uuid not null,
  line_id uuid not null,
  sector_id uuid not null,
  -- Kind of the catalog sector when the order was confirmed; 'other' sectors
  -- (no Kitchen/Bar screen) keep their items queued until a later task.
  sector_kind text not null check (sector_kind in ('kitchen', 'bar', 'other')),
  status text not null default 'queued'
    check (status in ('queued', 'preparing', 'ready')),
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  ready_at timestamptz,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, location_id, order_id, line_id),
  foreign key (tenant_id, location_id, order_id, line_id)
    references private.confirmed_order_items(tenant_id, location_id, order_id, line_id)
    on delete restrict,
  foreign key (tenant_id, updated_by)
    references public.staff_members(tenant_id, id) on delete restrict,
  check ((status = 'queued') = (started_at is null and ready_at is null)),
  check (status <> 'ready' or (started_at is not null and ready_at is not null))
);

create table private.production_item_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  location_id uuid not null,
  order_id uuid not null,
  line_id uuid not null,
  from_status text not null check (from_status in ('queued', 'preparing')),
  to_status text not null check (to_status in ('preparing', 'ready')),
  staff_member_id uuid not null,
  command_id uuid not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, location_id, order_id, line_id, to_status),
  foreign key (tenant_id, location_id, order_id, line_id)
    references private.production_items(tenant_id, location_id, order_id, line_id)
    on delete restrict,
  foreign key (tenant_id, staff_member_id)
    references public.staff_members(tenant_id, id) on delete restrict,
  check ((from_status, to_status) in (('queued', 'preparing'), ('preparing', 'ready')))
);

create index production_items_board_idx
  on private.production_items (tenant_id, location_id, sector_kind, status);

-- A production row only moves forward one step and nothing else about it
-- changes; rows are never deleted. The history is append-only.
create function private.guard_production_item_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op <> 'UPDATE'
    or (old.status, new.status) not in (('queued', 'preparing'), ('preparing', 'ready'))
    or (to_jsonb(new) - array['status', 'started_at', 'ready_at', 'updated_by', 'updated_at'])
      is distinct from
      (to_jsonb(old) - array['status', 'started_at', 'ready_at', 'updated_by', 'updated_at'])
  then
    raise exception 'production items only move forward one step' using errcode = 'PT209';
  end if;
  return new;
end;
$$;

create trigger production_items_guard_change
before update or delete on private.production_items
for each row execute function private.guard_production_item_change();
create trigger production_items_no_truncate
before truncate on private.production_items
for each statement execute function private.reject_append_only_change();
create trigger production_item_events_append_only
before update or delete on private.production_item_events
for each row execute function private.reject_append_only_change();
create trigger production_item_events_no_truncate
before truncate on private.production_item_events
for each statement execute function private.reject_append_only_change();

revoke all on table private.production_items, private.production_item_events
from public, anon, authenticated, authenticator;

-- 2. Distribution -----------------------------------------------------------

-- Kind of a sector in the catalog revision the order was confirmed against.
create function private.production_sector_kind(
  target_tenant_id uuid,
  target_location_id uuid,
  target_revision integer,
  target_sector_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select coalesce((
    select sector.value ->> 'kind'
    from private.published_catalogs catalog,
      jsonb_array_elements(catalog.snapshot -> 'sectors') sector
    where catalog.tenant_id = target_tenant_id
      and catalog.location_id = target_location_id
      and catalog.revision = target_revision
      and sector.value ->> 'id' = target_sector_id::text
      and sector.value ->> 'kind' in ('kitchen', 'bar')
  ), 'other');
$$;

-- Every confirmed item gets exactly one production row. The key makes a repeat
-- harmless: a retried confirmation replays its stored result and never reaches
-- this trigger, and even a direct duplicate would be ignored.
create function private.enqueue_production_item()
returns trigger
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
begin
  insert into private.production_items (
    tenant_id, location_id, order_id, line_id, sector_id, sector_kind
  )
  select new.tenant_id, new.location_id, new.order_id, new.line_id,
    new.production_sector_id,
    private.production_sector_kind(
      new.tenant_id, new.location_id, confirmed.catalog_revision,
      new.production_sector_id
    )
  from private.confirmed_orders confirmed
  where confirmed.tenant_id = new.tenant_id
    and confirmed.location_id = new.location_id
    and confirmed.id = new.order_id
  on conflict do nothing;
  return new;
end;
$$;

create trigger confirmed_order_items_enqueue_production
after insert on private.confirmed_order_items
for each row execute function private.enqueue_production_item();

-- Orders confirmed before this migration also reach the screens.
insert into private.production_items (
  tenant_id, location_id, order_id, line_id, sector_id, sector_kind
)
select item.tenant_id, item.location_id, item.order_id, item.line_id,
  item.production_sector_id,
  private.production_sector_kind(
    item.tenant_id, item.location_id, confirmed.catalog_revision,
    item.production_sector_id
  )
from private.confirmed_order_items item
join private.confirmed_orders confirmed
  on confirmed.tenant_id = item.tenant_id
  and confirmed.location_id = item.location_id
  and confirmed.id = item.order_id
on conflict do nothing;

-- 3. Authorization and derived state -----------------------------------------

-- Cocina sees kitchen items and Barra bar items. Waiters and managers have no
-- production screen, and neither does staff of another location.
create function private.production_actor_kind(
  target_tenant_id uuid,
  target_location_id uuid,
  target_staff_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_role text;
begin
  select member.role into actor_role
  from public.staff_members member
  where member.tenant_id = target_tenant_id
    and member.location_id = target_location_id
    and member.id = target_staff_id
    and member.is_active
    and member.role in ('kitchen', 'bar');
  if actor_role is null then
    raise exception 'staff member cannot operate production' using errcode = 'PT200';
  end if;
  return actor_role;
end;
$$;

create function private.production_status_of(target_statuses text[])
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when bool_and(status = 'ready') then 'ready'
    when bool_and(status = 'queued') then 'queued'
    else 'in_preparation'
  end
  from unnest(target_statuses) status;
$$;

-- 4. Board ----------------------------------------------------------------------

-- One ticket per order and sector kind. Active tickets come first, then the ten
-- most recently completed, so a ready ticket stays visible for a moment.
create function private.production_board(
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
declare
  actor_kind text := private.production_actor_kind(
    target_tenant_id, target_location_id, target_staff_id
  );
  result jsonb;
begin
  with mine as (
    select item.order_id, item.line_id, item.status, item.ready_at,
      line.position, line.title, line.variant_title, line.quantity
    from private.production_items item
    join private.confirmed_order_items line
      on line.tenant_id = item.tenant_id
      and line.location_id = item.location_id
      and line.order_id = item.order_id
      and line.line_id = item.line_id
    where item.tenant_id = target_tenant_id
      and item.location_id = target_location_id
      and item.sector_kind = actor_kind
  ),
  tickets as (
    select
      mine.order_id,
      private.production_status_of(array_agg(mine.status)) as status,
      max(mine.ready_at) as completed_at,
      jsonb_agg(jsonb_build_object(
        'lineId', mine.line_id,
        'title', mine.title,
        'variantTitle', mine.variant_title,
        'quantity', mine.quantity,
        'status', mine.status
      ) order by mine.position, mine.line_id) as items
    from mine
    group by mine.order_id
  ),
  ranked as (
    select tickets.*,
      row_number() over (
        partition by (tickets.status = 'ready')
        order by tickets.completed_at desc, tickets.order_id
      ) as completed_rank
    from tickets
  )
  select jsonb_build_object(
    'sector', actor_kind,
    'tickets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'orderId', ranked.order_id,
        'tableId', confirmed.table_id,
        'tableLabel', floor_table.label,
        'attribution', confirmed.attribution,
        'dinerName', confirmed.diner_name,
        'seatLabel', confirmed.seat_label,
        'confirmedAt', confirmed.confirmed_at,
        'status', ranked.status,
        'orderStatus', (
          select private.production_status_of(array_agg(whole.status))
          from private.production_items whole
          where whole.tenant_id = target_tenant_id
            and whole.location_id = target_location_id
            and whole.order_id = ranked.order_id
        ),
        'items', ranked.items
      ) order by (ranked.status = 'ready'), confirmed.confirmed_at, ranked.order_id)
      from ranked
      join private.confirmed_orders confirmed
        on confirmed.tenant_id = target_tenant_id
        and confirmed.location_id = target_location_id
        and confirmed.id = ranked.order_id
      join private.floor_tables floor_table
        on floor_table.tenant_id = confirmed.tenant_id
        and floor_table.location_id = confirmed.location_id
        and floor_table.id = confirmed.table_id
      where ranked.status <> 'ready' or ranked.completed_rank <= 10
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

-- 5. Advancing an item ---------------------------------------------------------

-- Idempotent three ways: a repeated command id replays its stored result; a
-- different command asking for the state the item already has changes nothing;
-- the row lock serializes two screens. Moving back or skipping a step fails.
create function private.advance_production_item(
  target_tenant_id uuid,
  target_location_id uuid,
  target_staff_id uuid,
  target_command_id uuid,
  target_order_id uuid,
  target_line_id uuid,
  target_status text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_kind text := private.production_actor_kind(
    target_tenant_id, target_location_id, target_staff_id
  );
  stored jsonb;
  item_row private.production_items%rowtype;
  did_change boolean := false;
  derived text;
begin
  stored := private.claim_waiter_command(
    target_tenant_id, target_location_id, target_staff_id, target_command_id,
    jsonb_build_object(
      'kind', 'production_advance', 'orderId', target_order_id,
      'lineId', target_line_id, 'status', target_status
    )
  );
  if stored is not null then
    return stored;
  end if;

  if target_status not in ('queued', 'preparing', 'ready') then
    raise exception 'invalid production status' using errcode = 'PT212';
  end if;

  select * into item_row
  from private.production_items item
  where item.tenant_id = target_tenant_id
    and item.location_id = target_location_id
    and item.order_id = target_order_id
    and item.line_id = target_line_id
    and item.sector_kind = actor_kind
  for update;
  if not found then
    raise exception 'production item not found' using errcode = 'PT201';
  end if;

  if item_row.status <> target_status then
    if (item_row.status, target_status) not in
      (('queued', 'preparing'), ('preparing', 'ready'))
    then
      raise exception 'invalid production transition' using errcode = 'PT220';
    end if;
    update private.production_items item
    set status = target_status,
        started_at = case when target_status = 'preparing' then now() else item.started_at end,
        ready_at = case when target_status = 'ready' then now() else item.ready_at end,
        updated_by = target_staff_id,
        updated_at = now()
    where item.tenant_id = target_tenant_id
      and item.location_id = target_location_id
      and item.order_id = target_order_id
      and item.line_id = target_line_id;
    insert into private.production_item_events (
      tenant_id, location_id, order_id, line_id, from_status, to_status,
      staff_member_id, command_id
    ) values (
      target_tenant_id, target_location_id, target_order_id, target_line_id,
      item_row.status, target_status, target_staff_id, target_command_id
    );
    perform private.append_audit_event(
      target_tenant_id, 'staff', target_staff_id, 'production.item_advanced',
      'Ítem de producción actualizado por el personal',
      'production:' || gen_random_uuid()::text, 'production_item', target_line_id
    );
    did_change := true;
  end if;

  select private.production_status_of(array_agg(whole.status)) into derived
  from private.production_items whole
  where whole.tenant_id = target_tenant_id
    and whole.location_id = target_location_id
    and whole.order_id = target_order_id;

  return private.finish_waiter_command(
    target_tenant_id, target_location_id, target_staff_id, target_command_id,
    jsonb_build_object(
      'orderId', target_order_id,
      'lineId', target_line_id,
      'status', target_status,
      'orderStatus', derived,
      'changed', did_change
    )
  );
end;
$$;

-- 6. Privileges ------------------------------------------------------------------

revoke all on function
  private.guard_production_item_change(),
  private.production_sector_kind(uuid, uuid, integer, uuid),
  private.enqueue_production_item(),
  private.production_actor_kind(uuid, uuid, uuid),
  private.production_status_of(text[]),
  private.production_board(uuid, uuid, uuid),
  private.advance_production_item(uuid, uuid, uuid, uuid, uuid, uuid, text)
from public, anon, authenticated;

grant execute on function
  private.production_board(uuid, uuid, uuid),
  private.advance_production_item(uuid, uuid, uuid, uuid, uuid, uuid, text)
to authenticator;

commit;
