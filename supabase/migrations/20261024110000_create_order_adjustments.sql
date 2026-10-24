begin;

-- Delivery, shortages and cancellations (T21).
--
-- Confirmed orders and their items stay append-only (T19). What happens to an
-- item afterwards lives in `production_items` (the item state, now with
-- delivered / exception / cancelled / replaced) and `production_item_events` (its
-- history), and the economic effect of a replacement or a cancellation lives in
-- `order_adjustments`, linked to the original item. Nothing here deletes an item
-- or gives stock back: a consumption already made is never erased.
--
-- The account and the ledger (T22) read these adjustments; no money moves here.

-- 1. Item states ----------------------------------------------------------------

alter table private.production_items
  drop constraint production_items_check,
  drop constraint production_items_check1,
  drop constraint production_items_status_check,
  add column delivered_at timestamptz,
  add constraint production_items_status_check check (
    status in (
      'queued', 'preparing', 'ready', 'delivered', 'exception', 'cancelled',
      'replaced'
    )
  ),
  add constraint production_items_queued_check check (
    status <> 'queued' or (started_at is null and ready_at is null)
  ),
  add constraint production_items_ready_check check (
    status <> 'ready' or (started_at is not null and ready_at is not null)
  ),
  add constraint production_items_delivered_check check (
    status <> 'delivered' or delivered_at is not null
  );

alter table private.production_item_events
  drop constraint production_item_events_check,
  drop constraint production_item_events_from_status_check,
  drop constraint production_item_events_to_status_check,
  add column reason text check (reason is null or length(reason) between 1 and 200),
  add constraint production_item_events_from_status_check check (
    from_status in ('queued', 'preparing', 'ready', 'exception')
  ),
  add constraint production_item_events_to_status_check check (
    to_status in (
      'preparing', 'ready', 'delivered', 'exception', 'cancelled', 'replaced'
    )
  ),
  add constraint production_item_events_step_check check (
    (from_status, to_status) in (
      ('queued', 'preparing'), ('preparing', 'ready'), ('ready', 'delivered'),
      ('queued', 'exception'), ('preparing', 'exception'),
      ('queued', 'cancelled'), ('preparing', 'cancelled'),
      ('exception', 'cancelled'), ('exception', 'replaced')
    )
  );

-- An item only takes the documented steps and nothing but its state changes.
create or replace function private.guard_production_item_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  movable constant text[] := array[
    'status', 'started_at', 'ready_at', 'delivered_at', 'updated_by', 'updated_at'
  ];
begin
  if tg_op <> 'UPDATE'
    or (old.status, new.status) not in (
      ('queued', 'preparing'), ('preparing', 'ready'), ('ready', 'delivered'),
      ('queued', 'exception'), ('preparing', 'exception'),
      ('queued', 'cancelled'), ('preparing', 'cancelled'),
      ('exception', 'cancelled'), ('exception', 'replaced')
    )
    or (to_jsonb(new) - movable) is distinct from (to_jsonb(old) - movable)
  then
    raise exception 'production items only take the documented steps'
      using errcode = 'PT209';
  end if;
  return new;
end;
$$;

-- Cancelled and replaced items are off the order; a shortage needs attention.
create or replace function private.production_status_of(target_statuses text[])
returns text
language sql
immutable
set search_path = ''
as $$
  with live as (
    select status from unnest(target_statuses) status
    where status not in ('cancelled', 'replaced')
  )
  select case
    when not exists (select 1 from live) then 'cancelled'
    when exists (select 1 from live where status = 'exception') then 'exception'
    when not exists (select 1 from live where status <> 'delivered') then 'delivered'
    when not exists (select 1 from live where status not in ('ready', 'delivered')) then 'ready'
    when not exists (select 1 from live where status <> 'queued') then 'queued'
    else 'in_preparation'
  end;
$$;

-- A replacement may live in a sector that did not exist in the revision the order
-- was confirmed against: fall back to the latest published revision.
create or replace function private.enqueue_production_item()
returns trigger
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  order_revision integer;
  sector_kind text;
begin
  select confirmed.catalog_revision into order_revision
  from private.confirmed_orders confirmed
  where confirmed.tenant_id = new.tenant_id
    and confirmed.location_id = new.location_id
    and confirmed.id = new.order_id;
  sector_kind := private.production_sector_kind(
    new.tenant_id, new.location_id, order_revision, new.production_sector_id
  );
  if sector_kind = 'other' then
    sector_kind := private.production_sector_kind(
      new.tenant_id, new.location_id,
      (select max(catalog.revision) from private.published_catalogs catalog
       where catalog.tenant_id = new.tenant_id
         and catalog.location_id = new.location_id),
      new.production_sector_id
    );
  end if;
  insert into private.production_items (
    tenant_id, location_id, order_id, line_id, sector_id, sector_kind
  ) values (
    new.tenant_id, new.location_id, new.order_id, new.line_id,
    new.production_sector_id, sector_kind
  ) on conflict do nothing;
  return new;
end;
$$;

-- The board keeps active tickets first and the ten latest completed ones
-- (ready, delivered or cancelled).
create or replace function private.production_board(
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
    select item.order_id, item.line_id, item.status,
      coalesce(item.delivered_at, item.ready_at, item.updated_at) as moved_at,
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
      max(mine.moved_at) as completed_at,
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
      (tickets.status in ('ready', 'delivered', 'cancelled')) as completed,
      row_number() over (
        partition by (tickets.status in ('ready', 'delivered', 'cancelled'))
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
      ) order by ranked.completed, confirmed.confirmed_at, ranked.order_id)
      from ranked
      join private.confirmed_orders confirmed
        on confirmed.tenant_id = target_tenant_id
        and confirmed.location_id = target_location_id
        and confirmed.id = ranked.order_id
      join private.floor_tables floor_table
        on floor_table.tenant_id = confirmed.tenant_id
        and floor_table.location_id = confirmed.location_id
        and floor_table.id = confirmed.table_id
      where not ranked.completed or ranked.completed_rank <= 10
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

-- 2. Adjustments -------------------------------------------------------------------

create table private.order_adjustments (
  id uuid not null default gen_random_uuid(),
  tenant_id uuid not null,
  location_id uuid not null,
  order_id uuid not null,
  original_line_id uuid not null,
  kind text not null check (kind in ('replacement', 'cancellation')),
  status text not null check (status in ('proposed', 'accepted', 'rejected')),
  reason text check (reason is null or length(reason) between 1 and 200),
  quantity integer not null check (quantity between 1 and 20),
  original_total_cents integer not null check (original_total_cents >= 0),
  replacement_product_id uuid,
  replacement_variant_id uuid,
  replacement_title text,
  replacement_variant_title text,
  replacement_sector_id uuid,
  replacement_unit_price_cents integer check (replacement_unit_price_cents >= 0),
  replacement_total_cents integer check (replacement_total_cents >= 0),
  replacement_line_id uuid,
  difference_cents integer not null,
  proposed_by uuid not null,
  proposed_command_id uuid not null,
  decided_by uuid,
  decided_command_id uuid,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, location_id, id),
  foreign key (tenant_id, location_id, order_id, original_line_id)
    references private.confirmed_order_items(tenant_id, location_id, order_id, line_id)
    on delete restrict,
  foreign key (tenant_id, location_id, order_id, replacement_line_id)
    references private.confirmed_order_items(tenant_id, location_id, order_id, line_id)
    on delete restrict,
  foreign key (tenant_id, proposed_by)
    references public.staff_members(tenant_id, id) on delete restrict,
  foreign key (tenant_id, decided_by)
    references public.staff_members(tenant_id, id) on delete restrict,
  -- A cancellation is decided when it is made and carries no replacement; a
  -- replacement records the economic difference against the original item.
  check (
    (kind = 'cancellation'
      and status = 'accepted'
      and reason is not null
      and replacement_product_id is null
      and replacement_total_cents is null
      and difference_cents = -original_total_cents)
    or (kind = 'replacement'
      and replacement_product_id is not null
      and replacement_total_cents is not null
      and replacement_unit_price_cents is not null
      and difference_cents = replacement_total_cents - original_total_cents
      and (status = 'proposed') = (decided_by is null)
      and (status = 'accepted') = (replacement_line_id is not null)
      and (status <> 'rejected' or reason is not null))
  )
);

-- An item has at most one open proposal and is resolved at most once.
create unique index order_adjustments_open_proposal_idx
  on private.order_adjustments (tenant_id, location_id, order_id, original_line_id)
  where status = 'proposed';
create unique index order_adjustments_resolved_idx
  on private.order_adjustments (tenant_id, location_id, order_id, original_line_id)
  where status = 'accepted';
create index order_adjustments_order_idx
  on private.order_adjustments (tenant_id, location_id, order_id);

create function private.guard_order_adjustment_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  movable constant text[] := array[
    'status', 'reason', 'replacement_line_id', 'decided_by',
    'decided_command_id', 'decided_at', 'updated_at'
  ];
begin
  if tg_op <> 'UPDATE'
    or old.status <> 'proposed'
    or new.status not in ('accepted', 'rejected')
    or (to_jsonb(new) - movable) is distinct from (to_jsonb(old) - movable)
  then
    raise exception 'an order adjustment is decided once and never rewritten'
      using errcode = 'PT209';
  end if;
  return new;
end;
$$;

create trigger order_adjustments_guard_change
before update or delete on private.order_adjustments
for each row execute function private.guard_order_adjustment_change();
create trigger order_adjustments_no_truncate
before truncate on private.order_adjustments
for each statement execute function private.reject_append_only_change();

revoke all on table private.order_adjustments
from public, anon, authenticated, authenticator;

-- 3. Helpers ---------------------------------------------------------------------------

-- Price, title and sector of a product in the latest published menu, without
-- touching stock. The same rules as quoting an order line.
create function private.catalog_unit_quote(
  target_tenant_id uuid,
  target_location_id uuid,
  target_product_id uuid,
  target_variant_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set row_security = off
as $$
declare
  publication private.published_catalogs%rowtype;
  product jsonb;
  variant jsonb;
  product_title text;
  variant_title text;
begin
  select * into publication
  from private.published_catalogs current_publication
  where current_publication.tenant_id = target_tenant_id
    and current_publication.location_id = target_location_id
  order by current_publication.revision desc
  limit 1;
  if not found then
    raise exception 'catalog is not published' using errcode = 'PT102';
  end if;

  select value into product
  from jsonb_array_elements(publication.snapshot -> 'products')
  where value ->> 'id' = target_product_id::text;
  if product is null
    or exists (
      select 1 from private.catalog_product_availability availability
      where availability.tenant_id = target_tenant_id
        and availability.location_id = target_location_id
        and availability.product_id = target_product_id
        and not availability.is_available
    )
  then
    raise exception 'product is not available in the current catalog' using errcode = 'PT104';
  end if;

  if target_variant_id is not null then
    select value into variant
    from jsonb_array_elements(product -> 'variants')
    where value ->> 'id' = target_variant_id::text;
    if variant is null then
      raise exception 'variant is not in the current catalog' using errcode = 'PT105';
    end if;
    select content ->> 'title' into variant_title
    from jsonb_array_elements(variant -> 'content') content
    order by (content ->> 'language' = 'es') desc
    limit 1;
  end if;
  select content ->> 'title' into product_title
  from jsonb_array_elements(product -> 'content') content
  order by (content ->> 'language' = 'es') desc
  limit 1;

  return jsonb_build_object(
    'revision', publication.revision,
    'title', product_title,
    'variantTitle', variant_title,
    'sectorId', product ->> 'sectorId',
    'unitPriceCents', (product ->> 'priceCents')::integer
      + coalesce((variant ->> 'priceDeltaCents')::integer, 0)
  );
end;
$$;

create function private.order_status_of(
  target_tenant_id uuid,
  target_location_id uuid,
  target_order_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select private.production_status_of(array_agg(item.status))
  from private.production_items item
  where item.tenant_id = target_tenant_id
    and item.location_id = target_location_id
    and item.order_id = target_order_id;
$$;

-- Trimmed reason between 1 and 200 characters, or PT212.
create function private.required_reason(target_reason text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  trimmed text := btrim(coalesce(target_reason, ''));
begin
  if length(trimmed) not between 1 and 200 then
    raise exception 'a reason of 1 to 200 characters is required' using errcode = 'PT212';
  end if;
  return trimmed;
end;
$$;

-- 4. Delivery ------------------------------------------------------------------------------

create function private.deliver_order_item(
  target_tenant_id uuid,
  target_location_id uuid,
  target_staff_id uuid,
  target_command_id uuid,
  target_order_id uuid,
  target_line_id uuid
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
    target_tenant_id, target_location_id, target_staff_id
  );
  stored jsonb;
  order_table uuid;
  item_row private.production_items%rowtype;
  did_change boolean := false;
begin
  stored := private.claim_waiter_command(
    target_tenant_id, target_location_id, target_staff_id, target_command_id,
    jsonb_build_object('kind', 'deliver_item', 'orderId', target_order_id, 'lineId', target_line_id)
  );
  if stored is not null then
    return stored;
  end if;

  select confirmed.table_id into order_table
  from private.confirmed_orders confirmed
  where confirmed.tenant_id = target_tenant_id
    and confirmed.location_id = target_location_id
    and confirmed.id = target_order_id;
  if order_table is null
    or not private.waiter_serves_table(
      target_tenant_id, target_location_id, target_staff_id, actor_role, order_table
    )
  then
    raise exception 'order not found' using errcode = 'PT201';
  end if;

  select * into item_row
  from private.production_items item
  where item.tenant_id = target_tenant_id
    and item.location_id = target_location_id
    and item.order_id = target_order_id
    and item.line_id = target_line_id
  for update;
  if not found then
    raise exception 'order item not found' using errcode = 'PT201';
  end if;

  if item_row.status <> 'delivered' then
    if item_row.status <> 'ready' then
      raise exception 'only a ready item can be delivered' using errcode = 'PT221';
    end if;
    update private.production_items item
    set status = 'delivered', delivered_at = now(),
        updated_by = target_staff_id, updated_at = now()
    where item.tenant_id = target_tenant_id
      and item.location_id = target_location_id
      and item.order_id = target_order_id
      and item.line_id = target_line_id;
    insert into private.production_item_events (
      tenant_id, location_id, order_id, line_id, from_status, to_status,
      staff_member_id, command_id
    ) values (
      target_tenant_id, target_location_id, target_order_id, target_line_id,
      'ready', 'delivered', target_staff_id, target_command_id
    );
    perform private.append_audit_event(
      target_tenant_id, 'staff', target_staff_id, 'order_item.delivered',
      'Ítem entregado en la mesa', 'delivery:' || gen_random_uuid()::text,
      'production_item', target_line_id
    );
    did_change := true;
  end if;

  return private.finish_waiter_command(
    target_tenant_id, target_location_id, target_staff_id, target_command_id,
    jsonb_build_object(
      'orderId', target_order_id,
      'lineId', target_line_id,
      'status', 'delivered',
      'orderStatus', private.order_status_of(target_tenant_id, target_location_id, target_order_id),
      'changed', did_change
    )
  );
end;
$$;

-- 5. Shortage ------------------------------------------------------------------------------

-- Production reports it cannot make an item. The item, its consumption and its
-- stock stay as they are: the shortage is resolved later by replacing or
-- cancelling it.
create function private.report_production_exception(
  target_tenant_id uuid,
  target_location_id uuid,
  target_staff_id uuid,
  target_command_id uuid,
  target_order_id uuid,
  target_line_id uuid,
  target_reason text
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
  clean_reason text;
  item_row private.production_items%rowtype;
  did_change boolean := false;
begin
  stored := private.claim_waiter_command(
    target_tenant_id, target_location_id, target_staff_id, target_command_id,
    jsonb_build_object(
      'kind', 'report_exception', 'orderId', target_order_id,
      'lineId', target_line_id, 'reason', target_reason
    )
  );
  if stored is not null then
    return stored;
  end if;
  clean_reason := private.required_reason(target_reason);

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

  if item_row.status <> 'exception' then
    if item_row.status not in ('queued', 'preparing') then
      raise exception 'invalid production transition' using errcode = 'PT220';
    end if;
    update private.production_items item
    set status = 'exception', updated_by = target_staff_id, updated_at = now()
    where item.tenant_id = target_tenant_id
      and item.location_id = target_location_id
      and item.order_id = target_order_id
      and item.line_id = target_line_id;
    insert into private.production_item_events (
      tenant_id, location_id, order_id, line_id, from_status, to_status,
      staff_member_id, command_id, reason
    ) values (
      target_tenant_id, target_location_id, target_order_id, target_line_id,
      item_row.status, 'exception', target_staff_id, target_command_id, clean_reason
    );
    perform private.append_audit_event(
      target_tenant_id, 'staff', target_staff_id, 'production.exception_reported',
      'Faltante informado por producción', 'exception:' || gen_random_uuid()::text,
      'production_item', target_line_id
    );
    did_change := true;
  end if;

  return private.finish_waiter_command(
    target_tenant_id, target_location_id, target_staff_id, target_command_id,
    jsonb_build_object(
      'orderId', target_order_id,
      'lineId', target_line_id,
      'status', 'exception',
      'orderStatus', private.order_status_of(target_tenant_id, target_location_id, target_order_id),
      'changed', did_change
    )
  );
end;
$$;

-- 6. Replacement -----------------------------------------------------------------------

-- Proposes a replacement for an item with a shortage. The price comes from the
-- published menu; the waiter then records whether the diner accepts it.
create function private.propose_item_replacement(
  target_tenant_id uuid,
  target_location_id uuid,
  target_staff_id uuid,
  target_command_id uuid,
  target_order_id uuid,
  target_line_id uuid,
  target_product_id uuid,
  target_variant_id uuid
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
    target_tenant_id, target_location_id, target_staff_id
  );
  stored jsonb;
  order_table uuid;
  item_row private.production_items%rowtype;
  original private.confirmed_order_items%rowtype;
  quote jsonb;
  adjustment_id uuid;
  replacement_total integer;
begin
  stored := private.claim_waiter_command(
    target_tenant_id, target_location_id, target_staff_id, target_command_id,
    jsonb_build_object(
      'kind', 'propose_replacement', 'orderId', target_order_id,
      'lineId', target_line_id, 'productId', target_product_id,
      'variantId', target_variant_id
    )
  );
  if stored is not null then
    return stored;
  end if;

  select confirmed.table_id into order_table
  from private.confirmed_orders confirmed
  where confirmed.tenant_id = target_tenant_id
    and confirmed.location_id = target_location_id
    and confirmed.id = target_order_id;
  if order_table is null
    or not private.waiter_serves_table(
      target_tenant_id, target_location_id, target_staff_id, actor_role, order_table
    )
  then
    raise exception 'order not found' using errcode = 'PT201';
  end if;

  select * into item_row
  from private.production_items item
  where item.tenant_id = target_tenant_id
    and item.location_id = target_location_id
    and item.order_id = target_order_id
    and item.line_id = target_line_id
  for update;
  if not found then
    raise exception 'order item not found' using errcode = 'PT201';
  end if;
  if item_row.status <> 'exception' then
    raise exception 'only an item with a shortage can be replaced' using errcode = 'PT220';
  end if;
  if exists (
    select 1 from private.order_adjustments adjustment
    where adjustment.tenant_id = target_tenant_id
      and adjustment.location_id = target_location_id
      and adjustment.order_id = target_order_id
      and adjustment.original_line_id = target_line_id
      and adjustment.status = 'proposed'
  ) then
    raise exception 'the item already has an open replacement' using errcode = 'PT224';
  end if;

  select * into original
  from private.confirmed_order_items line
  where line.tenant_id = target_tenant_id
    and line.location_id = target_location_id
    and line.order_id = target_order_id
    and line.line_id = target_line_id;
  quote := private.catalog_unit_quote(
    target_tenant_id, target_location_id, target_product_id, target_variant_id
  );
  replacement_total := (quote ->> 'unitPriceCents')::integer * original.quantity;

  insert into private.order_adjustments (
    tenant_id, location_id, order_id, original_line_id, kind, status, quantity,
    original_total_cents, replacement_product_id, replacement_variant_id,
    replacement_title, replacement_variant_title, replacement_sector_id,
    replacement_unit_price_cents, replacement_total_cents, difference_cents,
    proposed_by, proposed_command_id
  ) values (
    target_tenant_id, target_location_id, target_order_id, target_line_id,
    'replacement', 'proposed', original.quantity, original.total_cents,
    target_product_id, target_variant_id, quote ->> 'title',
    quote ->> 'variantTitle', (quote ->> 'sectorId')::uuid,
    (quote ->> 'unitPriceCents')::integer, replacement_total,
    replacement_total - original.total_cents, target_staff_id, target_command_id
  ) returning id into adjustment_id;
  perform private.append_audit_event(
    target_tenant_id, 'staff', target_staff_id, 'order_item.replacement_proposed',
    'Reemplazo propuesto para un faltante', 'adjustment:' || gen_random_uuid()::text,
    'order_adjustment', adjustment_id
  );

  return private.finish_waiter_command(
    target_tenant_id, target_location_id, target_staff_id, target_command_id,
    jsonb_build_object(
      'adjustmentId', adjustment_id,
      'orderId', target_order_id,
      'lineId', target_line_id,
      'status', 'proposed',
      'replacementTitle', quote ->> 'title',
      'replacementVariantTitle', quote ->> 'variantTitle',
      'originalTotalCents', original.total_cents,
      'replacementTotalCents', replacement_total,
      'differenceCents', replacement_total - original.total_cents
    )
  );
end;
$$;

-- The waiter records the diner's answer. Accepting appends the replacement as a
-- new item (queued for production) and retires the original one; rejecting
-- leaves the shortage open for another proposal or a cancellation.
create function private.decide_item_replacement(
  target_tenant_id uuid,
  target_location_id uuid,
  target_staff_id uuid,
  target_command_id uuid,
  target_adjustment_id uuid,
  target_decision text,
  target_reason text
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
    target_tenant_id, target_location_id, target_staff_id
  );
  stored jsonb;
  clean_reason text;
  adjustment private.order_adjustments%rowtype;
  order_table uuid;
  item_row private.production_items%rowtype;
  quote jsonb;
  new_line uuid := gen_random_uuid();
begin
  stored := private.claim_waiter_command(
    target_tenant_id, target_location_id, target_staff_id, target_command_id,
    jsonb_build_object(
      'kind', 'decide_replacement', 'adjustmentId', target_adjustment_id,
      'decision', target_decision, 'reason', target_reason
    )
  );
  if stored is not null then
    return stored;
  end if;
  if target_decision not in ('accept', 'reject') then
    raise exception 'invalid decision' using errcode = 'PT212';
  end if;
  if target_decision = 'reject' then
    clean_reason := private.required_reason(target_reason);
  end if;

  select * into adjustment
  from private.order_adjustments candidate
  where candidate.tenant_id = target_tenant_id
    and candidate.location_id = target_location_id
    and candidate.id = target_adjustment_id
    and candidate.kind = 'replacement'
  for update;
  if not found then
    raise exception 'adjustment not found' using errcode = 'PT201';
  end if;
  select confirmed.table_id into order_table
  from private.confirmed_orders confirmed
  where confirmed.tenant_id = target_tenant_id
    and confirmed.location_id = target_location_id
    and confirmed.id = adjustment.order_id;
  if not private.waiter_serves_table(
    target_tenant_id, target_location_id, target_staff_id, actor_role, order_table
  ) then
    raise exception 'adjustment not found' using errcode = 'PT201';
  end if;
  if adjustment.status <> 'proposed' then
    raise exception 'the replacement was already decided' using errcode = 'PT224';
  end if;

  if target_decision = 'reject' then
    update private.order_adjustments candidate
    set status = 'rejected', reason = clean_reason, decided_by = target_staff_id,
        decided_command_id = target_command_id, decided_at = now(), updated_at = now()
    where candidate.tenant_id = target_tenant_id
      and candidate.location_id = target_location_id
      and candidate.id = target_adjustment_id;
    perform private.append_audit_event(
      target_tenant_id, 'staff', target_staff_id, 'order_item.replacement_rejected',
      'Reemplazo rechazado por el comensal', 'adjustment:' || gen_random_uuid()::text,
      'order_adjustment', target_adjustment_id
    );
    return private.finish_waiter_command(
      target_tenant_id, target_location_id, target_staff_id, target_command_id,
      jsonb_build_object(
        'adjustmentId', target_adjustment_id,
        'status', 'rejected',
        'replacementLineId', null,
        'orderStatus', private.order_status_of(target_tenant_id, target_location_id, adjustment.order_id)
      )
    );
  end if;

  select * into item_row
  from private.production_items item
  where item.tenant_id = target_tenant_id
    and item.location_id = target_location_id
    and item.order_id = adjustment.order_id
    and item.line_id = adjustment.original_line_id
  for update;
  if item_row.status <> 'exception' then
    raise exception 'only an item with a shortage can be replaced' using errcode = 'PT220';
  end if;

  -- Re-prices against the menu: a price that moved since the proposal is refused
  -- instead of charging the diner something they did not accept.
  quote := private.quote_and_reserve_lines(
    target_tenant_id, target_location_id,
    jsonb_build_array(jsonb_build_object(
      'lineId', new_line,
      'productId', adjustment.replacement_product_id,
      'variantId', to_jsonb(adjustment.replacement_variant_id),
      'quantity', adjustment.quantity,
      'unitPriceCents', adjustment.replacement_unit_price_cents
    )),
    true
  );

  insert into private.confirmed_order_items (
    tenant_id, location_id, order_id, line_id, position, product_id, variant_id,
    production_sector_id, title, variant_title, quantity, unit_price_cents,
    total_cents
  )
  select target_tenant_id, target_location_id, adjustment.order_id,
    new_line,
    (select coalesce(max(line.position), -1) + 1
     from private.confirmed_order_items line
     where line.tenant_id = target_tenant_id
       and line.location_id = target_location_id
       and line.order_id = adjustment.order_id),
    adjustment.replacement_product_id, adjustment.replacement_variant_id,
    (quoted.value ->> 'sectorId')::uuid, quoted.value ->> 'title',
    quoted.value ->> 'variantTitle', adjustment.quantity,
    (quoted.value ->> 'unitPriceCents')::integer,
    (quoted.value ->> 'totalCents')::integer
  from jsonb_array_elements(quote -> 'lines') quoted;

  update private.production_items item
  set status = 'replaced', updated_by = target_staff_id, updated_at = now()
  where item.tenant_id = target_tenant_id
    and item.location_id = target_location_id
    and item.order_id = adjustment.order_id
    and item.line_id = adjustment.original_line_id;
  insert into private.production_item_events (
    tenant_id, location_id, order_id, line_id, from_status, to_status,
    staff_member_id, command_id, reason
  ) values (
    target_tenant_id, target_location_id, adjustment.order_id,
    adjustment.original_line_id, 'exception', 'replaced', target_staff_id,
    target_command_id, 'Reemplazado'
  );
  update private.order_adjustments candidate
  set status = 'accepted', replacement_line_id = new_line,
      decided_by = target_staff_id, decided_command_id = target_command_id,
      decided_at = now(), updated_at = now()
  where candidate.tenant_id = target_tenant_id
    and candidate.location_id = target_location_id
    and candidate.id = target_adjustment_id;
  perform private.append_audit_event(
    target_tenant_id, 'staff', target_staff_id, 'order_item.replacement_accepted',
    'Reemplazo aceptado por el comensal', 'adjustment:' || gen_random_uuid()::text,
    'order_adjustment', target_adjustment_id
  );

  return private.finish_waiter_command(
    target_tenant_id, target_location_id, target_staff_id, target_command_id,
    jsonb_build_object(
      'adjustmentId', target_adjustment_id,
      'status', 'accepted',
      'replacementLineId', new_line,
      'orderStatus', private.order_status_of(target_tenant_id, target_location_id, adjustment.order_id)
    )
  );
end;
$$;

-- 7. Cancellation ---------------------------------------------------------------------------

-- Only a manager cancels an item that is not ready yet, always with a reason.
-- The confirmed item and the stock already consumed stay untouched.
create function private.cancel_order_item(
  target_tenant_id uuid,
  target_location_id uuid,
  target_staff_id uuid,
  target_command_id uuid,
  target_order_id uuid,
  target_line_id uuid,
  target_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_role text;
  stored jsonb;
  clean_reason text;
  item_row private.production_items%rowtype;
  original private.confirmed_order_items%rowtype;
  adjustment_id uuid;
begin
  select member.role into actor_role
  from public.staff_members member
  where member.tenant_id = target_tenant_id
    and member.location_id = target_location_id
    and member.id = target_staff_id
    and member.is_active;
  if actor_role is null then
    raise exception 'staff member cannot operate the salon' using errcode = 'PT200';
  end if;
  if actor_role <> 'manager' then
    raise exception 'only a manager can cancel an item' using errcode = 'PT222';
  end if;

  stored := private.claim_waiter_command(
    target_tenant_id, target_location_id, target_staff_id, target_command_id,
    jsonb_build_object(
      'kind', 'cancel_item', 'orderId', target_order_id,
      'lineId', target_line_id, 'reason', target_reason
    )
  );
  if stored is not null then
    return stored;
  end if;
  clean_reason := private.required_reason(target_reason);

  select * into item_row
  from private.production_items item
  where item.tenant_id = target_tenant_id
    and item.location_id = target_location_id
    and item.order_id = target_order_id
    and item.line_id = target_line_id
  for update;
  if not found then
    raise exception 'order item not found' using errcode = 'PT201';
  end if;
  if item_row.status not in ('queued', 'preparing', 'exception') then
    raise exception 'invalid production transition' using errcode = 'PT220';
  end if;

  select * into original
  from private.confirmed_order_items line
  where line.tenant_id = target_tenant_id
    and line.location_id = target_location_id
    and line.order_id = target_order_id
    and line.line_id = target_line_id;

  update private.production_items item
  set status = 'cancelled', updated_by = target_staff_id, updated_at = now()
  where item.tenant_id = target_tenant_id
    and item.location_id = target_location_id
    and item.order_id = target_order_id
    and item.line_id = target_line_id;
  insert into private.production_item_events (
    tenant_id, location_id, order_id, line_id, from_status, to_status,
    staff_member_id, command_id, reason
  ) values (
    target_tenant_id, target_location_id, target_order_id, target_line_id,
    item_row.status, 'cancelled', target_staff_id, target_command_id, clean_reason
  );
  insert into private.order_adjustments (
    tenant_id, location_id, order_id, original_line_id, kind, status, reason,
    quantity, original_total_cents, difference_cents, proposed_by,
    proposed_command_id, decided_by, decided_command_id, decided_at
  ) values (
    target_tenant_id, target_location_id, target_order_id, target_line_id,
    'cancellation', 'accepted', clean_reason, original.quantity, original.total_cents,
    -original.total_cents, target_staff_id, target_command_id, target_staff_id,
    target_command_id, now()
  ) returning id into adjustment_id;
  perform private.append_audit_event(
    target_tenant_id, 'staff', target_staff_id, 'order_item.cancelled',
    'Ítem cancelado por el encargado', 'adjustment:' || gen_random_uuid()::text,
    'order_adjustment', adjustment_id
  );

  return private.finish_waiter_command(
    target_tenant_id, target_location_id, target_staff_id, target_command_id,
    jsonb_build_object(
      'adjustmentId', adjustment_id,
      'orderId', target_order_id,
      'lineId', target_line_id,
      'status', 'cancelled',
      'differenceCents', -original.total_cents,
      'orderStatus', private.order_status_of(target_tenant_id, target_location_id, target_order_id)
    )
  );
end;
$$;

-- 8. Waiter view of the orders in progress -----------------------------------------------

create function private.waiter_orders_view(
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
  actor_role text := private.waiter_actor_role(
    target_tenant_id, target_location_id, target_staff_id
  );
  result jsonb;
begin
  with scoped as (
    select confirmed.id, confirmed.table_id, confirmed.attribution,
      confirmed.diner_name, confirmed.seat_label, confirmed.confirmed_at,
      confirmed.total_cents, floor_table.label as table_label,
      private.order_status_of(
        target_tenant_id, target_location_id, confirmed.id
      ) as status
    from private.confirmed_orders confirmed
    join private.floor_tables floor_table
      on floor_table.tenant_id = confirmed.tenant_id
      and floor_table.location_id = confirmed.location_id
      and floor_table.id = confirmed.table_id
    where confirmed.tenant_id = target_tenant_id
      and confirmed.location_id = target_location_id
      and private.waiter_serves_table(
        target_tenant_id, target_location_id, target_staff_id, actor_role,
        confirmed.table_id
      )
  )
  select jsonb_build_object('orders', coalesce((
    select jsonb_agg(jsonb_build_object(
      'orderId', scoped.id,
      'tableId', scoped.table_id,
      'tableLabel', scoped.table_label,
      'attribution', scoped.attribution,
      'dinerName', scoped.diner_name,
      'seatLabel', scoped.seat_label,
      'confirmedAt', scoped.confirmed_at,
      'status', scoped.status,
      'totalCents', scoped.total_cents,
      'adjustmentCents', (
        select coalesce(sum(adjustment.difference_cents), 0)::integer
        from private.order_adjustments adjustment
        where adjustment.tenant_id = target_tenant_id
          and adjustment.location_id = target_location_id
          and adjustment.order_id = scoped.id
          and adjustment.status = 'accepted'
      ),
      'items', (
        select jsonb_agg(jsonb_build_object(
          'lineId', line.line_id,
          'title', line.title,
          'variantTitle', line.variant_title,
          'quantity', line.quantity,
          'unitPriceCents', line.unit_price_cents,
          'totalCents', line.total_cents,
          'status', item.status,
          'sector', item.sector_kind,
          'exceptionReason', (
            select event.reason
            from private.production_item_events event
            where event.tenant_id = target_tenant_id
              and event.location_id = target_location_id
              and event.order_id = line.order_id
              and event.line_id = line.line_id
              and event.to_status = 'exception'
          ),
          'adjustment', (
            select jsonb_build_object(
              'id', adjustment.id,
              'kind', adjustment.kind,
              'status', adjustment.status,
              'differenceCents', adjustment.difference_cents,
              'replacementTitle', case
                when adjustment.replacement_title is null then null
                else adjustment.replacement_title
                  || coalesce(' (' || adjustment.replacement_variant_title || ')', '')
              end
            )
            from private.order_adjustments adjustment
            where adjustment.tenant_id = target_tenant_id
              and adjustment.location_id = target_location_id
              and adjustment.order_id = line.order_id
              and adjustment.original_line_id = line.line_id
            order by adjustment.created_at desc, adjustment.id
            limit 1
          )
        ) order by line.position, line.line_id)
        from private.confirmed_order_items line
        join private.production_items item
          on item.tenant_id = line.tenant_id
          and item.location_id = line.location_id
          and item.order_id = line.order_id
          and item.line_id = line.line_id
        where line.tenant_id = target_tenant_id
          and line.location_id = target_location_id
          and line.order_id = scoped.id
      )
    ) order by scoped.confirmed_at, scoped.id)
    from scoped
    where scoped.status not in ('delivered', 'cancelled')
  ), '[]'::jsonb)) into result;
  return result;
end;
$$;

-- 9. Privileges -------------------------------------------------------------------------------

revoke all on function
  private.guard_order_adjustment_change(),
  private.catalog_unit_quote(uuid, uuid, uuid, uuid),
  private.order_status_of(uuid, uuid, uuid),
  private.required_reason(text),
  private.deliver_order_item(uuid, uuid, uuid, uuid, uuid, uuid),
  private.report_production_exception(uuid, uuid, uuid, uuid, uuid, uuid, text),
  private.propose_item_replacement(uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid),
  private.decide_item_replacement(uuid, uuid, uuid, uuid, uuid, text, text),
  private.cancel_order_item(uuid, uuid, uuid, uuid, uuid, uuid, text),
  private.waiter_orders_view(uuid, uuid, uuid)
from public, anon, authenticated;

grant execute on function
  private.deliver_order_item(uuid, uuid, uuid, uuid, uuid, uuid),
  private.report_production_exception(uuid, uuid, uuid, uuid, uuid, uuid, text),
  private.propose_item_replacement(uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid),
  private.decide_item_replacement(uuid, uuid, uuid, uuid, uuid, text, text),
  private.cancel_order_item(uuid, uuid, uuid, uuid, uuid, uuid, text),
  private.waiter_orders_view(uuid, uuid, uuid)
to authenticator;

commit;
