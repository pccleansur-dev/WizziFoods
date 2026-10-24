begin;

-- Waiter operations (T19): live salon view, call claiming, validating or
-- rejecting a T18 order intent, and manual orders.
--
-- Confirming an order is deliberately NOT a payment, NOT a table session and NOT
-- a production ticket: no ledger, balance, payment or kitchen row is created here
-- (T22–T24 own money and the account, T20 owns production). Confirmed orders and
-- their items are append-only.
--
-- Every function receives a staff id that the API resolved from the Bearer
-- session. It still re-checks, inside SQL, that the staff member is active, belongs
-- to the location, has an operating role and (for waiters) serves the table's
-- sector. Nothing here accepts a price, a total or a role from the caller.

-- 1. Intent decisions -------------------------------------------------------

alter table private.order_intents drop constraint order_intents_status_check;
alter table private.order_intents drop constraint order_intents_check2;
alter table private.order_intents
  add constraint order_intents_status_check
    check (status in ('awaiting_waiter', 'payment_pending', 'confirmed', 'rejected')),
  -- An online (Mercado Pago) intent can only wait for its payment: a waiter can
  -- never confirm it, not even by writing the table directly.
  add constraint order_intents_status_path_check check (
    (payment_path = 'online' and status = 'payment_pending')
    or (payment_path = 'in_person' and status in ('awaiting_waiter', 'confirmed', 'rejected'))
  );

-- Deleting is not guarded here: a decided intent is referenced by its decision
-- and order (restrict), so only undecided intents can ever be removed.
create function private.guard_order_intent_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'awaiting_waiter'
    or new.status not in ('confirmed', 'rejected')
    or (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status')
  then
    raise exception 'an order intent may only be decided once' using errcode = 'PT209';
  end if;
  return new;
end;
$$;

create trigger order_intents_guard_change
before update on private.order_intents
for each row execute function private.guard_order_intent_change();

alter table private.waiter_calls
  add column claimed_by uuid,
  add column claimed_at timestamptz,
  add constraint waiter_calls_claimed_by_fkey
    foreign key (tenant_id, claimed_by)
    references public.staff_members(tenant_id, id) on delete restrict,
  add constraint waiter_calls_claim_state check (
    (status <> 'acknowledged' or claimed_by is not null)
    and (status <> 'open' or claimed_by is null)
  );

create table private.waiter_commands (
  tenant_id uuid not null,
  location_id uuid not null,
  staff_member_id uuid not null,
  command_id uuid not null,
  request_payload jsonb not null check (jsonb_typeof(request_payload) = 'object'),
  result jsonb,
  created_at timestamptz not null default now(),
  primary key (tenant_id, location_id, staff_member_id, command_id),
  foreign key (tenant_id, staff_member_id)
    references public.staff_members(tenant_id, id) on delete restrict,
  foreign key (tenant_id, location_id)
    references public.locations(tenant_id, id) on delete restrict,
  check (result is null or jsonb_typeof(result) = 'object')
);

create table private.order_intent_decisions (
  tenant_id uuid not null,
  location_id uuid not null,
  intent_id uuid not null,
  decision text not null check (decision in ('confirmed', 'rejected')),
  reason text check (reason = btrim(reason) and length(reason) between 1 and 200),
  decided_by uuid not null,
  command_id uuid not null,
  decided_at timestamptz not null default now(),
  primary key (tenant_id, location_id, intent_id),
  foreign key (tenant_id, location_id, intent_id)
    references private.order_intents(tenant_id, location_id, id) on delete restrict,
  foreign key (tenant_id, decided_by)
    references public.staff_members(tenant_id, id) on delete restrict,
  check ((decision = 'rejected') = (reason is not null))
);

-- 2. Confirmed orders (append-only) ----------------------------------------

create table private.confirmed_orders (
  id uuid not null default gen_random_uuid(),
  tenant_id uuid not null,
  location_id uuid not null,
  table_id uuid not null,
  group_id uuid,
  source text not null check (source in ('intent', 'manual')),
  intent_id uuid,
  command_id uuid not null,
  confirmed_by uuid not null,
  attribution text not null check (attribution in ('table', 'individual')),
  diner_name text check (diner_name = btrim(diner_name) and length(diner_name) between 1 and 80),
  seat_label text check (seat_label = btrim(seat_label) and length(seat_label) between 1 and 40),
  catalog_revision integer not null check (catalog_revision > 0),
  total_cents integer not null check (total_cents >= 0),
  confirmed_at timestamptz not null default now(),
  primary key (tenant_id, location_id, id),
  unique (tenant_id, location_id, intent_id),
  foreign key (tenant_id, location_id, table_id)
    references private.floor_tables(tenant_id, location_id, id) on delete restrict,
  foreign key (tenant_id, location_id, intent_id)
    references private.order_intents(tenant_id, location_id, id) on delete restrict,
  foreign key (tenant_id, confirmed_by)
    references public.staff_members(tenant_id, id) on delete restrict,
  check ((source = 'intent') = (intent_id is not null)),
  check (attribution = 'table' or (diner_name is not null and seat_label is not null))
);

create table private.confirmed_order_items (
  tenant_id uuid not null,
  location_id uuid not null,
  order_id uuid not null,
  line_id uuid not null,
  position integer not null check (position >= 0),
  product_id uuid not null,
  variant_id uuid,
  production_sector_id uuid not null,
  title text not null check (length(title) between 1 and 160),
  variant_title text check (length(variant_title) between 1 and 160),
  quantity integer not null check (quantity between 1 and 20),
  unit_price_cents integer not null check (unit_price_cents >= 0),
  total_cents integer not null check (total_cents = unit_price_cents * quantity),
  primary key (tenant_id, location_id, order_id, line_id),
  foreign key (tenant_id, location_id, order_id)
    references private.confirmed_orders(tenant_id, location_id, id) on delete restrict
);

create function private.reject_append_only_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = 'PT209';
end;
$$;

create trigger confirmed_orders_append_only
before update or delete on private.confirmed_orders
for each row execute function private.reject_append_only_change();
create trigger confirmed_orders_no_truncate
before truncate on private.confirmed_orders
for each statement execute function private.reject_append_only_change();
create trigger confirmed_order_items_append_only
before update or delete on private.confirmed_order_items
for each row execute function private.reject_append_only_change();
create trigger confirmed_order_items_no_truncate
before truncate on private.confirmed_order_items
for each statement execute function private.reject_append_only_change();
create trigger order_intent_decisions_append_only
before update or delete on private.order_intent_decisions
for each row execute function private.reject_append_only_change();

create index confirmed_orders_table_idx
  on private.confirmed_orders (tenant_id, location_id, table_id, confirmed_at desc);

revoke all on table
  private.waiter_commands,
  private.order_intent_decisions,
  private.confirmed_orders,
  private.confirmed_order_items
from public, anon, authenticated, authenticator;

-- 3. Authorization helpers --------------------------------------------------

create function private.waiter_actor_role(
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
    and member.role in ('waiter', 'manager');
  if actor_role is null then
    raise exception 'staff member cannot operate the salon' using errcode = 'PT200';
  end if;
  return actor_role;
end;
$$;

-- A manager serves every active table of the location. A waiter only serves the
-- tables of the sectors assigned to them; a manager never widens that.
create function private.waiter_serves_table(
  target_tenant_id uuid,
  target_location_id uuid,
  target_staff_id uuid,
  target_role text,
  target_table_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select exists (
    select 1
    from private.floor_tables floor_table
    where floor_table.tenant_id = target_tenant_id
      and floor_table.location_id = target_location_id
      and floor_table.id = target_table_id
      and floor_table.retired_at is null
      and (
        target_role = 'manager'
        or exists (
          select 1
          from private.staff_sector_assignments assignment
          where assignment.tenant_id = target_tenant_id
            and assignment.location_id = target_location_id
            and assignment.staff_member_id = target_staff_id
            and assignment.floor_sector_id = floor_table.sector_id
        )
      )
  );
$$;

-- Same reading as T16: no row means available; a table that cannot be used keeps
-- its own state, otherwise an occupied table makes the rest of its group occupied.
create function private.waiter_table_state(
  target_tenant_id uuid,
  target_location_id uuid,
  target_table_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select coalesce(
    (select own.state
     from private.floor_table_service_states own
     where own.tenant_id = target_tenant_id
       and own.location_id = target_location_id
       and own.table_id = target_table_id),
    case when exists (
      select 1
      from private.floor_group_members member
      join private.floor_group_members mate
        on mate.tenant_id = member.tenant_id
        and mate.location_id = member.location_id
        and mate.group_id = member.group_id
      join private.floor_table_service_states mate_state
        on mate_state.tenant_id = mate.tenant_id
        and mate_state.location_id = mate.location_id
        and mate_state.table_id = mate.table_id
      where member.tenant_id = target_tenant_id
        and member.location_id = target_location_id
        and member.table_id = target_table_id
        and mate_state.state = 'occupied'
    ) then 'occupied' else 'available' end
  );
$$;

-- 4. Live salon view --------------------------------------------------------

create function private.waiter_salon_view(
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
    select
      floor_table.id,
      floor_table.label,
      floor_table.position,
      floor_table.level_id,
      sector.name as sector_name,
      membership.group_id,
      coalesce(own.state, 'available') as own_state,
      private.waiter_serves_table(
        target_tenant_id, target_location_id, target_staff_id,
        actor_role, floor_table.id
      ) as in_scope
    from private.floor_tables floor_table
    join private.floor_sectors sector
      on sector.tenant_id = floor_table.tenant_id
      and sector.location_id = floor_table.location_id
      and sector.id = floor_table.sector_id
    left join private.floor_group_members membership
      on membership.tenant_id = floor_table.tenant_id
      and membership.location_id = floor_table.location_id
      and membership.table_id = floor_table.id
    left join private.floor_table_service_states own
      on own.tenant_id = floor_table.tenant_id
      and own.location_id = floor_table.location_id
      and own.table_id = floor_table.id
    where floor_table.tenant_id = target_tenant_id
      and floor_table.location_id = target_location_id
      and floor_table.retired_at is null
  ),
  open_calls as (
    select call.id, call.table_id, call.intent_id, call.payment_method,
      call.status, call.created_at, call.claimed_by,
      claimer.display_name as claimed_by_name, scoped.label as table_label
    from private.waiter_calls call
    join scoped on scoped.id = call.table_id and scoped.in_scope
    left join public.staff_members claimer
      on claimer.tenant_id = call.tenant_id and claimer.id = call.claimed_by
    where call.tenant_id = target_tenant_id
      and call.location_id = target_location_id
      and call.status in ('open', 'acknowledged')
  ),
  pending_intents as (
    select intent.id, intent.table_id, intent.attribution, intent.diner_name,
      intent.seat_label, intent.payment_method, intent.total_cents,
      intent.created_at, open_calls.id as call_id, open_calls.table_label
    from private.order_intents intent
    join open_calls on open_calls.intent_id = intent.id
    where intent.tenant_id = target_tenant_id
      and intent.location_id = target_location_id
      and intent.status = 'awaiting_waiter'
  ),
  units as (
    select
      'table'::text as kind,
      scoped.id,
      'Mesa ' || scoped.label as label,
      null::text as name,
      scoped.level_id as floor_id,
      scoped.sector_name,
      scoped.own_state as state,
      jsonb_build_array(jsonb_build_object(
        'id', scoped.id, 'label', scoped.label, 'inScope', true
      )) as tables,
      array[scoped.id] as table_ids,
      scoped.position as sort_key
    from scoped
    where scoped.group_id is null and scoped.in_scope
    union all
    select
      'group',
      group_row.id,
      'Mesas ' || string_agg(scoped.label, ' + ' order by scoped.position),
      group_row.name,
      (array_agg(scoped.level_id order by scoped.position))[1],
      (array_agg(scoped.sector_name order by scoped.in_scope desc, scoped.position))[1],
      case
        when bool_or(scoped.own_state = 'occupied') then 'occupied'
        when bool_or(scoped.own_state = 'needs_cleaning') then 'needs_cleaning'
        when bool_or(scoped.own_state = 'out_of_service') then 'out_of_service'
        else 'available'
      end,
      jsonb_agg(jsonb_build_object(
        'id', scoped.id, 'label', scoped.label, 'inScope', scoped.in_scope
      ) order by scoped.position),
      array_agg(scoped.id order by scoped.position),
      min(scoped.position)
    from private.floor_groups group_row
    join scoped on scoped.group_id = group_row.id
    where group_row.tenant_id = target_tenant_id
      and group_row.location_id = target_location_id
    group by group_row.id, group_row.name
    having bool_or(scoped.in_scope)
  )
  select jsonb_build_object(
    'floors', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', level.id, 'name', level.name, 'shortName', level.short_name
      ) order by level.position)
      from private.floor_levels level
      where level.tenant_id = target_tenant_id
        and level.location_id = target_location_id
        and level.id in (select units.floor_id from units)
    ), '[]'::jsonb),
    'units', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', units.id,
        'kind', units.kind,
        'label', units.label,
        'name', units.name,
        'floorId', units.floor_id,
        'sectorName', units.sector_name,
        'state', units.state,
        'tables', units.tables,
        'session', null,
        'balanceCents', null,
        'openCalls', (select count(*) from open_calls where open_calls.table_id = any (units.table_ids)),
        'pendingIntents', (select count(*) from pending_intents where pending_intents.table_id = any (units.table_ids))
      ) order by units.sort_key, units.id)
      from units
    ), '[]'::jsonb),
    'calls', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', open_calls.id,
        'tableId', open_calls.table_id,
        'tableLabel', open_calls.table_label,
        'intentId', open_calls.intent_id,
        'reason', 'order_validation',
        'status', open_calls.status,
        'paymentMethod', open_calls.payment_method,
        'createdAt', open_calls.created_at,
        'claimedByMe', open_calls.claimed_by is not distinct from target_staff_id,
        'claimedByName', open_calls.claimed_by_name
      ) order by open_calls.created_at, open_calls.id)
      from open_calls
    ), '[]'::jsonb),
    'intents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pending_intents.id,
        'callId', pending_intents.call_id,
        'tableId', pending_intents.table_id,
        'tableLabel', pending_intents.table_label,
        'attribution', pending_intents.attribution,
        'dinerName', pending_intents.diner_name,
        'seatLabel', pending_intents.seat_label,
        'paymentMethod', pending_intents.payment_method,
        'totalCents', pending_intents.total_cents,
        'createdAt', pending_intents.created_at,
        'items', (
          select jsonb_agg(jsonb_build_object(
            'lineId', item.line_id,
            'productId', item.product_id,
            'variantId', item.variant_id,
            'quantity', item.quantity,
            'title', item.title,
            'variantTitle', item.variant_title,
            'unitPriceCents', item.unit_price_cents,
            'totalCents', item.total_cents
          ) order by item.created_at, item.title, item.line_id)
          from private.order_intent_items item
          where item.tenant_id = target_tenant_id
            and item.location_id = target_location_id
            and item.intent_id = pending_intents.id
        )
      ) order by pending_intents.created_at, pending_intents.id)
      from pending_intents
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

-- 5. Command claiming (shared by every waiter write) ------------------------

-- Returns the stored result of a command that already ran, or null when this
-- call is the first one and now owns the command. A command id reused with other
-- data fails. Two simultaneous identical commands wait on the same row.
create function private.claim_waiter_command(
  target_tenant_id uuid,
  target_location_id uuid,
  target_staff_id uuid,
  target_command_id uuid,
  target_payload jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
declare
  claimed integer;
  command_row private.waiter_commands%rowtype;
begin
  insert into private.waiter_commands (
    tenant_id, location_id, staff_member_id, command_id, request_payload
  ) values (
    target_tenant_id, target_location_id, target_staff_id, target_command_id,
    target_payload
  ) on conflict do nothing;
  get diagnostics claimed = row_count;
  if claimed = 1 then
    return null;
  end if;

  select * into command_row
  from private.waiter_commands command
  where command.tenant_id = target_tenant_id
    and command.location_id = target_location_id
    and command.staff_member_id = target_staff_id
    and command.command_id = target_command_id
  for update;
  if command_row.request_payload is distinct from target_payload
    or command_row.result is null
  then
    raise exception 'waiter command already used with different data'
      using errcode = 'PT100';
  end if;
  return command_row.result;
end;
$$;

create function private.finish_waiter_command(
  target_tenant_id uuid,
  target_location_id uuid,
  target_staff_id uuid,
  target_command_id uuid,
  target_result jsonb
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
set row_security = off
as $$
  update private.waiter_commands command
  set result = target_result
  where command.tenant_id = target_tenant_id
    and command.location_id = target_location_id
    and command.staff_member_id = target_staff_id
    and command.command_id = target_command_id
  returning target_result;
$$;

-- 6. Claiming a call --------------------------------------------------------

create function private.claim_waiter_call(
  target_tenant_id uuid,
  target_location_id uuid,
  target_staff_id uuid,
  target_call_id uuid,
  target_command_id uuid
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
  call_row private.waiter_calls%rowtype;
begin
  stored := private.claim_waiter_command(
    target_tenant_id, target_location_id, target_staff_id, target_command_id,
    jsonb_build_object('kind', 'claim', 'callId', target_call_id)
  );
  if stored is not null then
    return stored;
  end if;

  select * into call_row
  from private.waiter_calls call
  where call.tenant_id = target_tenant_id
    and call.location_id = target_location_id
    and call.id = target_call_id
  for update;
  if not found or not private.waiter_serves_table(
    target_tenant_id, target_location_id, target_staff_id, actor_role,
    call_row.table_id
  ) then
    raise exception 'call not found' using errcode = 'PT201';
  end if;

  if call_row.status = 'open' then
    update private.waiter_calls call
    set status = 'acknowledged',
        claimed_by = target_staff_id,
        claimed_at = now(),
        updated_at = now()
    where call.tenant_id = target_tenant_id
      and call.location_id = target_location_id
      and call.id = target_call_id;
    perform private.append_audit_event(
      target_tenant_id, 'staff', target_staff_id, 'waiter_call.claimed',
      'Llamado reclamado por el personal', 'waiter:' || gen_random_uuid()::text,
      'waiter_call', target_call_id
    );
  elsif call_row.status = 'acknowledged' then
    if call_row.claimed_by <> target_staff_id then
      raise exception 'call already claimed' using errcode = 'PT203';
    end if;
  else
    raise exception 'call is closed' using errcode = 'PT204';
  end if;

  return private.finish_waiter_command(
    target_tenant_id, target_location_id, target_staff_id, target_command_id,
    jsonb_build_object(
      'callId', target_call_id, 'claimedByMe', true, 'status', 'acknowledged'
    )
  );
end;
$$;

-- 7. Quoting and confirming lines against the published menu ----------------

-- Resolves titles, prices and production sectors from the latest published
-- catalog, rechecks availability, and locks and decrements optional operational
-- stock. `lines` may carry the unit price the diner saw (intents): when it no
-- longer matches the menu the confirmation is refused instead of charging a
-- different amount.
create function private.quote_and_reserve_lines(
  target_tenant_id uuid,
  target_location_id uuid,
  target_lines jsonb,
  check_prices boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
declare
  publication private.published_catalogs%rowtype;
  requested jsonb;
  product jsonb;
  variant jsonb;
  product_title text;
  variant_title text;
  unit_price integer;
  total integer := 0;
  quoted jsonb := '[]'::jsonb;
  stock_row record;
begin
  perform 1 from private.location_publications location_publication
  where location_publication.tenant_id = target_tenant_id
    and location_publication.location_id = target_location_id
  for share;
  if not found then
    raise exception 'location is not published' using errcode = 'PT102';
  end if;

  select * into publication
  from private.published_catalogs current_publication
  where current_publication.tenant_id = target_tenant_id
    and current_publication.location_id = target_location_id
  order by current_publication.revision desc
  limit 1
  for share;
  if not found then
    raise exception 'catalog is not published' using errcode = 'PT102';
  end if;

  perform 1 from private.catalog_product_availability availability
  where availability.tenant_id = target_tenant_id
    and availability.location_id = target_location_id
    and availability.product_id in (
      select (line ->> 'productId')::uuid from jsonb_array_elements(target_lines) line
    )
  order by availability.product_id
  for share;
  perform 1 from private.product_operational_stock stock
  where stock.tenant_id = target_tenant_id
    and stock.location_id = target_location_id
    and stock.product_id in (
      select (line ->> 'productId')::uuid from jsonb_array_elements(target_lines) line
    )
  order by stock.product_id
  for update;

  for requested in select value from jsonb_array_elements(target_lines)
  loop
    select value into product
    from jsonb_array_elements(publication.snapshot -> 'products')
    where value ->> 'id' = requested ->> 'productId';
    if product is null then
      raise exception 'product is not in the current catalog' using errcode = 'PT104';
    end if;
    if exists (
      select 1 from private.catalog_product_availability availability
      where availability.tenant_id = target_tenant_id
        and availability.location_id = target_location_id
        and availability.product_id = (requested ->> 'productId')::uuid
        and not availability.is_available
    ) then
      raise exception 'product is unavailable' using errcode = 'PT104';
    end if;

    variant := null;
    variant_title := null;
    if requested -> 'variantId' <> 'null'::jsonb then
      select value into variant
      from jsonb_array_elements(product -> 'variants')
      where value ->> 'id' = requested ->> 'variantId';
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
    unit_price := (product ->> 'priceCents')::integer
      + coalesce((variant ->> 'priceDeltaCents')::integer, 0);
    if check_prices and (requested ->> 'unitPriceCents')::integer <> unit_price then
      raise exception 'menu price changed' using errcode = 'PT211';
    end if;
    total := total + unit_price * (requested ->> 'quantity')::integer;

    quoted := quoted || jsonb_build_array(jsonb_build_object(
      'lineId', requested ->> 'lineId',
      'productId', requested ->> 'productId',
      'variantId', requested -> 'variantId',
      'sectorId', product ->> 'sectorId',
      'quantity', (requested ->> 'quantity')::integer,
      'title', product_title,
      'variantTitle', variant_title,
      'unitPriceCents', unit_price,
      'totalCents', unit_price * (requested ->> 'quantity')::integer
    ));
  end loop;

  for stock_row in
    select stock.product_id, stock.available_quantity,
      sum((line ->> 'quantity')::integer)::integer as requested_quantity
    from private.product_operational_stock stock
    join jsonb_array_elements(target_lines) line
      on (line ->> 'productId')::uuid = stock.product_id
    where stock.tenant_id = target_tenant_id
      and stock.location_id = target_location_id
    group by stock.product_id, stock.available_quantity
  loop
    if stock_row.requested_quantity > stock_row.available_quantity then
      raise exception 'insufficient operational stock' using errcode = 'PT206';
    end if;
    update private.product_operational_stock stock
    set available_quantity = stock.available_quantity - stock_row.requested_quantity,
        updated_at = now()
    where stock.tenant_id = target_tenant_id
      and stock.location_id = target_location_id
      and stock.product_id = stock_row.product_id;
  end loop;

  return jsonb_build_object(
    'revision', publication.revision, 'totalCents', total, 'lines', quoted
  );
end;
$$;

-- Appends the order and its items and returns the contract result. Payment stays
-- unrecorded and nothing is sent to production.
create function private.append_confirmed_order(
  target_tenant_id uuid,
  target_location_id uuid,
  target_staff_id uuid,
  target_command_id uuid,
  target_table_id uuid,
  target_intent_id uuid,
  target_attribution text,
  target_diner_name text,
  target_seat_label text,
  target_quote jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
declare
  order_id uuid := gen_random_uuid();
begin
  insert into private.confirmed_orders (
    id, tenant_id, location_id, table_id, group_id, source, intent_id,
    command_id, confirmed_by, attribution, diner_name, seat_label,
    catalog_revision, total_cents
  ) values (
    order_id, target_tenant_id, target_location_id, target_table_id,
    (select membership.group_id
     from private.floor_group_members membership
     where membership.tenant_id = target_tenant_id
       and membership.location_id = target_location_id
       and membership.table_id = target_table_id),
    case when target_intent_id is null then 'manual' else 'intent' end,
    target_intent_id, target_command_id, target_staff_id, target_attribution,
    target_diner_name, target_seat_label,
    (target_quote ->> 'revision')::integer, (target_quote ->> 'totalCents')::integer
  );

  insert into private.confirmed_order_items (
    tenant_id, location_id, order_id, line_id, position, product_id, variant_id,
    production_sector_id, title, variant_title, quantity, unit_price_cents,
    total_cents
  )
  select target_tenant_id, target_location_id, order_id,
    (line.value ->> 'lineId')::uuid, (line.ordinality - 1)::integer,
    (line.value ->> 'productId')::uuid,
    nullif(line.value ->> 'variantId', '')::uuid,
    (line.value ->> 'sectorId')::uuid,
    line.value ->> 'title', line.value ->> 'variantTitle',
    (line.value ->> 'quantity')::integer,
    (line.value ->> 'unitPriceCents')::integer,
    (line.value ->> 'totalCents')::integer
  from jsonb_array_elements(target_quote -> 'lines') with ordinality line;

  perform private.append_audit_event(
    target_tenant_id, 'staff', target_staff_id,
    case when target_intent_id is null then 'order.manual_confirmed'
         else 'order.confirmed' end,
    case when target_intent_id is null then 'Pedido manual confirmado por el personal'
         else 'Pedido del comensal confirmado por el personal' end,
    'waiter:' || gen_random_uuid()::text, 'confirmed_order', order_id
  );

  return jsonb_build_object(
    'orderId', order_id,
    'tableId', target_table_id,
    'source', case when target_intent_id is null then 'manual' else 'intent' end,
    'status', 'confirmed',
    'payment', jsonb_build_object('state', 'not_recorded'),
    'accountDecision', 'pending',
    'totalCents', (target_quote ->> 'totalCents')::integer,
    'items', (
      select jsonb_agg(jsonb_build_object(
        'lineId', line ->> 'lineId',
        'productId', line ->> 'productId',
        'variantId', line -> 'variantId',
        'quantity', (line ->> 'quantity')::integer,
        'title', line ->> 'title',
        'variantTitle', line -> 'variantTitle',
        'unitPriceCents', (line ->> 'unitPriceCents')::integer,
        'totalCents', (line ->> 'totalCents')::integer
      ))
      from jsonb_array_elements(target_quote -> 'lines') line
    )
  );
end;
$$;

-- A table accepts orders while available or occupied. Cleaning and out-of-service
-- tables are enabled by the cleaning flow (T26), never silently here.
create function private.assert_table_accepts_orders(
  target_tenant_id uuid,
  target_location_id uuid,
  target_table_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = ''
set row_security = off
as $$
declare
  state text := private.waiter_table_state(
    target_tenant_id, target_location_id, target_table_id
  );
begin
  if state not in ('available', 'occupied')
    or (state = 'available' and not private.can_open_table_session(target_tenant_id))
  then
    raise exception 'table cannot accept orders' using errcode = 'PT210';
  end if;
end;
$$;

-- 8. Deciding an intent ------------------------------------------------------

create function private.decide_order_intent(
  target_tenant_id uuid,
  target_location_id uuid,
  target_staff_id uuid,
  target_intent_id uuid,
  target_command_id uuid,
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
  intent_row private.order_intents%rowtype;
  call_row private.waiter_calls%rowtype;
  quote jsonb;
  outcome jsonb;
begin
  if target_decision not in ('confirm', 'reject')
    or (target_decision = 'confirm') <> (target_reason is null)
    or (target_reason is not null
      and (target_reason <> btrim(target_reason) or length(target_reason) not between 1 and 200))
  then
    raise exception 'invalid decision' using errcode = 'PT212';
  end if;

  stored := private.claim_waiter_command(
    target_tenant_id, target_location_id, target_staff_id, target_command_id,
    jsonb_build_object(
      'kind', 'decision', 'intentId', target_intent_id,
      'decision', target_decision, 'reason', target_reason
    )
  );
  if stored is not null then
    return stored;
  end if;

  select * into intent_row
  from private.order_intents intent
  where intent.tenant_id = target_tenant_id
    and intent.location_id = target_location_id
    and intent.id = target_intent_id
  for update;
  if not found or not private.waiter_serves_table(
    target_tenant_id, target_location_id, target_staff_id, actor_role,
    intent_row.table_id
  ) then
    raise exception 'intent not found' using errcode = 'PT201';
  end if;
  if intent_row.status in ('confirmed', 'rejected') then
    raise exception 'intent already decided' using errcode = 'PT205';
  end if;
  if intent_row.status <> 'awaiting_waiter' or intent_row.payment_path <> 'in_person' then
    raise exception 'intent cannot be decided by staff' using errcode = 'PT207';
  end if;

  select * into call_row
  from private.waiter_calls call
  where call.tenant_id = target_tenant_id
    and call.location_id = target_location_id
    and call.intent_id = target_intent_id
  for update;
  if not found or call_row.status not in ('open', 'acknowledged') then
    raise exception 'call is closed' using errcode = 'PT204';
  end if;
  -- A call claimed by another waiter is theirs; a manager may still resolve it.
  if call_row.status = 'acknowledged'
    and call_row.claimed_by <> target_staff_id
    and actor_role <> 'manager'
  then
    raise exception 'call already claimed' using errcode = 'PT203';
  end if;

  if target_decision = 'confirm' then
    perform private.assert_table_accepts_orders(
      target_tenant_id, target_location_id, intent_row.table_id
    );
    quote := private.quote_and_reserve_lines(
      target_tenant_id, target_location_id,
      (select jsonb_agg(jsonb_build_object(
        'lineId', item.line_id,
        'productId', item.product_id,
        'variantId', coalesce(to_jsonb(item.variant_id::text), 'null'::jsonb),
        'quantity', item.quantity,
        'unitPriceCents', item.unit_price_cents
      ) order by item.created_at, item.title, item.line_id)
      from private.order_intent_items item
      where item.tenant_id = target_tenant_id
        and item.location_id = target_location_id
        and item.intent_id = target_intent_id),
      true
    );
    outcome := jsonb_build_object(
      'decision', 'confirmed',
      'order', private.append_confirmed_order(
        target_tenant_id, target_location_id, target_staff_id, target_command_id,
        intent_row.table_id, target_intent_id, intent_row.attribution,
        intent_row.diner_name, intent_row.seat_label, quote
      )
    );
  else
    outcome := jsonb_build_object('decision', 'rejected', 'intentId', target_intent_id);
    perform private.append_audit_event(
      target_tenant_id, 'staff', target_staff_id, 'order_intent.rejected',
      'Pedido del comensal rechazado por el personal',
      'waiter:' || gen_random_uuid()::text, 'order_intent', target_intent_id
    );
  end if;

  update private.order_intents intent
  set status = case when target_decision = 'confirm' then 'confirmed' else 'rejected' end
  where intent.tenant_id = target_tenant_id
    and intent.location_id = target_location_id
    and intent.id = target_intent_id;
  update private.waiter_calls call
  set status = case when target_decision = 'confirm' then 'closed' else 'cancelled' end,
      updated_at = now()
  where call.tenant_id = target_tenant_id
    and call.location_id = target_location_id
    and call.id = call_row.id;
  insert into private.order_intent_decisions (
    tenant_id, location_id, intent_id, decision, reason, decided_by, command_id
  ) values (
    target_tenant_id, target_location_id, target_intent_id,
    case when target_decision = 'confirm' then 'confirmed' else 'rejected' end,
    target_reason, target_staff_id, target_command_id
  );

  return private.finish_waiter_command(
    target_tenant_id, target_location_id, target_staff_id, target_command_id,
    outcome
  );
end;
$$;

-- 9. Manual orders ----------------------------------------------------------

create function private.create_manual_order(
  target_tenant_id uuid,
  target_location_id uuid,
  target_staff_id uuid,
  target_command_id uuid,
  target_table_id uuid,
  target_attribution text,
  target_diner_name text,
  target_seat_label text,
  target_items jsonb
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
  quote jsonb;
  outcome jsonb;
  uuid_pattern constant text :=
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  stored := private.claim_waiter_command(
    target_tenant_id, target_location_id, target_staff_id, target_command_id,
    jsonb_build_object(
      'kind', 'manual_order', 'tableId', target_table_id,
      'attribution', target_attribution, 'dinerName', target_diner_name,
      'seatLabel', target_seat_label, 'items', target_items
    )
  );
  if stored is not null then
    return stored;
  end if;

  if target_attribution not in ('table', 'individual')
    or (target_diner_name is not null and (
      target_diner_name <> btrim(target_diner_name)
      or length(target_diner_name) not between 1 and 80))
    or (target_seat_label is not null and (
      target_seat_label <> btrim(target_seat_label)
      or length(target_seat_label) not between 1 and 40))
    or (target_attribution = 'individual'
      and (target_diner_name is null or target_seat_label is null))
    or jsonb_typeof(target_items) <> 'array'
    or jsonb_array_length(target_items) not between 1 and 50
    or exists (
      select 1
      from jsonb_array_elements(target_items) item
      where jsonb_typeof(item) <> 'object'
        or (item - array['lineId','productId','quantity','variantId']::text[]) <> '{}'::jsonb
        or not (item ?& array['lineId','productId','quantity','variantId'])
        or (item ->> 'lineId') !~* uuid_pattern
        or (item ->> 'productId') !~* uuid_pattern
        or jsonb_typeof(item -> 'quantity') <> 'number'
        or (item ->> 'quantity') !~ '^[0-9]+$'
        or (item ->> 'quantity')::integer not between 1 and 20
        or not (item -> 'variantId' = 'null'::jsonb
          or (item ->> 'variantId') ~* uuid_pattern)
    )
    or (select count(*) <> count(distinct item ->> 'lineId')
        from jsonb_array_elements(target_items) item)
  then
    raise exception 'invalid manual order' using errcode = 'PT212';
  end if;

  if not private.waiter_serves_table(
    target_tenant_id, target_location_id, target_staff_id, actor_role,
    target_table_id
  ) then
    raise exception 'table not found' using errcode = 'PT201';
  end if;
  perform private.assert_table_accepts_orders(
    target_tenant_id, target_location_id, target_table_id
  );

  quote := private.quote_and_reserve_lines(
    target_tenant_id, target_location_id, target_items, false
  );
  outcome := private.append_confirmed_order(
    target_tenant_id, target_location_id, target_staff_id, target_command_id,
    target_table_id, null, target_attribution, target_diner_name,
    target_seat_label, quote
  );
  return private.finish_waiter_command(
    target_tenant_id, target_location_id, target_staff_id, target_command_id,
    outcome
  );
end;
$$;

-- 10. Privileges ------------------------------------------------------------

revoke all on function
  private.guard_order_intent_change(),
  private.reject_append_only_change(),
  private.waiter_actor_role(uuid, uuid, uuid),
  private.waiter_serves_table(uuid, uuid, uuid, text, uuid),
  private.waiter_table_state(uuid, uuid, uuid),
  private.claim_waiter_command(uuid, uuid, uuid, uuid, jsonb),
  private.finish_waiter_command(uuid, uuid, uuid, uuid, jsonb),
  private.quote_and_reserve_lines(uuid, uuid, jsonb, boolean),
  private.append_confirmed_order(uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, jsonb),
  private.assert_table_accepts_orders(uuid, uuid, uuid),
  private.waiter_salon_view(uuid, uuid, uuid),
  private.claim_waiter_call(uuid, uuid, uuid, uuid, uuid),
  private.decide_order_intent(uuid, uuid, uuid, uuid, uuid, text, text),
  private.create_manual_order(uuid, uuid, uuid, uuid, uuid, text, text, text, jsonb)
from public, anon, authenticated;

-- The runtime role only gets the four entry points, never the helpers.
grant execute on function
  private.waiter_salon_view(uuid, uuid, uuid),
  private.claim_waiter_call(uuid, uuid, uuid, uuid, uuid),
  private.decide_order_intent(uuid, uuid, uuid, uuid, uuid, text, text),
  private.create_manual_order(uuid, uuid, uuid, uuid, uuid, text, text, text, jsonb)
to authenticator;

commit;
