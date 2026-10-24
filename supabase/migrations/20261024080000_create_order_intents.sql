begin;

create table private.order_intent_commands (
  tenant_id uuid not null,
  location_id uuid not null,
  command_id uuid not null,
  request_payload jsonb not null check (jsonb_typeof(request_payload) = 'object'),
  result jsonb,
  created_at timestamptz not null default now(),
  primary key (tenant_id, location_id, command_id),
  foreign key (tenant_id, location_id)
    references public.locations(tenant_id, id) on delete restrict,
  check (result is null or jsonb_typeof(result) = 'object')
);

create table private.order_intents (
  id uuid not null default gen_random_uuid(),
  tenant_id uuid not null,
  location_id uuid not null,
  table_id uuid not null,
  group_id uuid,
  command_id uuid not null,
  attribution text not null check (attribution in ('table', 'individual')),
  diner_name text not null check (diner_name = btrim(diner_name) and length(diner_name) between 1 and 80),
  seat_label text check (seat_label = btrim(seat_label) and length(seat_label) between 1 and 40),
  payment_method text not null check (payment_method in ('cash', 'credit_card', 'debit_card', 'other_in_person', 'mercado_pago')),
  payment_path text not null check (payment_path in ('in_person', 'online')),
  status text not null check (status in ('awaiting_waiter', 'payment_pending')),
  catalog_revision integer not null check (catalog_revision > 0),
  total_cents integer not null check (total_cents >= 0),
  created_at timestamptz not null default now(),
  primary key (tenant_id, location_id, id),
  unique (tenant_id, location_id, command_id),
  foreign key (tenant_id, location_id, table_id)
    references private.floor_tables(tenant_id, location_id, id) on delete restrict,
  foreign key (tenant_id, location_id, command_id)
    references private.order_intent_commands(tenant_id, location_id, command_id) on delete restrict,
  check ((attribution = 'individual') = (seat_label is not null) or attribution = 'table'),
  check ((payment_path = 'online') = (payment_method = 'mercado_pago')),
  check ((payment_path = 'online' and status = 'payment_pending') or (payment_path = 'in_person' and status = 'awaiting_waiter'))
);

create table private.order_intent_items (
  tenant_id uuid not null,
  location_id uuid not null,
  intent_id uuid not null,
  line_id uuid not null,
  product_id uuid not null,
  variant_id uuid,
  production_sector_id uuid not null,
  title text not null check (length(title) between 1 and 160),
  variant_title text check (length(variant_title) between 1 and 160),
  quantity integer not null check (quantity between 1 and 20),
  unit_price_cents integer not null check (unit_price_cents >= 0),
  total_cents integer not null check (total_cents = unit_price_cents * quantity),
  created_at timestamptz not null default now(),
  primary key (tenant_id, location_id, intent_id, line_id),
  foreign key (tenant_id, location_id, intent_id)
    references private.order_intents(tenant_id, location_id, id) on delete restrict
    deferrable initially deferred
);

-- A missing row means stock is not tracked. Intents only revalidate this value;
-- T19/T24 must lock and decrement it when an order is actually confirmed.
create table private.product_operational_stock (
  tenant_id uuid not null,
  location_id uuid not null,
  product_id uuid not null,
  available_quantity integer not null check (available_quantity >= 0),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, location_id, product_id),
  foreign key (tenant_id, location_id)
    references public.locations(tenant_id, id) on delete cascade
);

create table private.waiter_calls (
  id uuid not null default gen_random_uuid(),
  tenant_id uuid not null,
  location_id uuid not null,
  table_id uuid not null,
  intent_id uuid not null,
  reason text not null check (reason = 'order_validation'),
  payment_method text not null check (payment_method in ('cash', 'credit_card', 'debit_card', 'other_in_person')),
  status text not null default 'open' check (status in ('open', 'acknowledged', 'closed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, location_id, id),
  unique (tenant_id, location_id, intent_id),
  foreign key (tenant_id, location_id, table_id)
    references private.floor_tables(tenant_id, location_id, id) on delete restrict,
  foreign key (tenant_id, location_id, intent_id)
    references private.order_intents(tenant_id, location_id, id) on delete restrict
);

create index order_intents_table_created_idx
  on private.order_intents (tenant_id, location_id, table_id, created_at desc);
create index waiter_calls_open_idx
  on private.waiter_calls (tenant_id, location_id, created_at)
  where status = 'open';

revoke all on table
  private.order_intent_commands,
  private.order_intents,
  private.order_intent_items,
  private.product_operational_stock,
  private.waiter_calls
from public, anon, authenticated, authenticator;

create function private.list_public_payment_methods(
  target_tenant_id uuid,
  target_location_id uuid
)
returns table (method text, payment_path text)
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select payment.method_key,
    case when payment.method_key = 'mercado_pago' then 'online' else 'in_person' end
  from private.payment_methods payment
  where payment.tenant_id = target_tenant_id
    and payment.location_id = target_location_id
    and exists (
      select 1 from private.location_publications publication
      where publication.tenant_id = target_tenant_id
        and publication.location_id = target_location_id
    )
    and private.payment_method_available(
      payment.tenant_id, payment.location_id, payment.method_key,
      payment.enabled, payment.public_config
    )
  order by array_position(array[
    'cash', 'credit_card', 'debit_card', 'other_in_person', 'mercado_pago'
  ], payment.method_key);
$$;

create function private.create_order_intent(
  target_tenant_id uuid,
  target_location_id uuid,
  target_token text,
  target_command_id uuid,
  target_attribution text,
  target_diner_name text,
  target_seat_label text,
  target_payment_method text,
  target_payment_path text,
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
  claimed integer;
  command_row private.order_intent_commands%rowtype;
  entry record;
  publication private.published_catalogs%rowtype;
  requested_item jsonb;
  product jsonb;
  variant jsonb;
  product_title text;
  variant_title text;
  unit_price integer;
  intent_id uuid := gen_random_uuid();
  call_id uuid;
  total integer := 0;
  quoted_items jsonb := '[]'::jsonb;
  normalized_payload jsonb;
  stock_row record;
begin
  normalized_payload := jsonb_build_object(
    'token', target_token,
    'attribution', target_attribution,
    'dinerName', target_diner_name,
    'seatLabel', target_seat_label,
    'paymentMethod', target_payment_method,
    'paymentPath', target_payment_path,
    'items', target_items
  );

  insert into private.order_intent_commands (
    tenant_id, location_id, command_id, request_payload
  ) values (
    target_tenant_id, target_location_id, target_command_id, normalized_payload
  ) on conflict do nothing;
  get diagnostics claimed = row_count;

  if claimed = 0 then
    select * into command_row
    from private.order_intent_commands command
    where command.tenant_id = target_tenant_id
      and command.location_id = target_location_id
      and command.command_id = target_command_id
    for update;
    if command_row.request_payload is distinct from normalized_payload then
      raise exception 'order intent command already used with different data'
        using errcode = 'PT100';
    end if;
    if command_row.result is null then
      raise exception 'order intent command has no result' using errcode = 'PT100';
    end if;
    return command_row.result;
  end if;

  if target_token !~ '^[0-9a-f]{64}$'
    or target_attribution not in ('table', 'individual')
    or target_payment_method not in ('cash', 'credit_card', 'debit_card', 'other_in_person', 'mercado_pago')
    or target_payment_path not in ('in_person', 'online')
    or ((target_payment_path = 'online') <> (target_payment_method = 'mercado_pago'))
    or target_diner_name is null
    or target_diner_name <> btrim(target_diner_name)
    or length(target_diner_name) not between 1 and 80
    or (target_seat_label is not null and (
      target_seat_label <> btrim(target_seat_label)
      or length(target_seat_label) not between 1 and 40
    ))
    or (target_attribution = 'individual' and target_seat_label is null)
    or jsonb_typeof(target_items) <> 'array'
    or jsonb_array_length(target_items) not between 1 and 50
  then
    raise exception 'invalid order intent' using errcode = 'PT107';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(target_items) item
    where jsonb_typeof(item) <> 'object'
      or (item - array['lineId','productId','quantity','variantId']::text[]) <> '{}'::jsonb
      or not (item ?& array['lineId','productId','quantity','variantId'])
      or (item ->> 'lineId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or (item ->> 'productId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or jsonb_typeof(item -> 'quantity') <> 'number'
      or (item ->> 'quantity') !~ '^[0-9]+$'
      or (item ->> 'quantity')::integer not between 1 and 20
      or not (
        item -> 'variantId' = 'null'::jsonb
        or (item ->> 'variantId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      )
  ) or (
    select count(*) <> count(distinct item ->> 'lineId')
    from jsonb_array_elements(target_items) item
  ) then
    raise exception 'invalid order intent items' using errcode = 'PT107';
  end if;

  perform 1
  from private.floor_table_qr_codes qr
  join private.floor_tables floor_table
    on floor_table.tenant_id = qr.tenant_id
    and floor_table.location_id = qr.location_id
    and floor_table.id = qr.table_id
  where qr.tenant_id = target_tenant_id
    and qr.location_id = target_location_id
    and qr.token = target_token
    and qr.status = 'active'
    and floor_table.retired_at is null
  for share of qr, floor_table;
  if not found then
    raise exception 'invalid table entry' using errcode = 'PT101';
  end if;

  select * into entry
  from private.resolve_table_entry(target_tenant_id, target_location_id, target_token);
  if not found then
    raise exception 'invalid table entry' using errcode = 'PT101';
  end if;
  if not entry.published
    or entry.service_state not in ('available', 'occupied')
    or (entry.service_state = 'available' and not entry.accepts_new_tables)
  then
    raise exception 'table cannot accept an order intent' using errcode = 'PT102';
  end if;

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

  perform private.ensure_payment_methods(target_tenant_id, target_location_id);
  perform 1 from private.payment_methods payment
  where payment.tenant_id = target_tenant_id
    and payment.location_id = target_location_id
    and payment.method_key = target_payment_method
    and private.payment_method_available(
      payment.tenant_id, payment.location_id, payment.method_key,
      payment.enabled, payment.public_config
    )
  for share;
  if not found then
    raise exception 'payment method is not available' using errcode = 'PT103';
  end if;

  -- Lock every current availability and optional stock row used by the intent.
  perform 1 from private.catalog_product_availability availability
  where availability.tenant_id = target_tenant_id
    and availability.location_id = target_location_id
    and availability.product_id in (
      select (item ->> 'productId')::uuid from jsonb_array_elements(target_items) item
    )
  for share;
  perform 1 from private.product_operational_stock stock
  where stock.tenant_id = target_tenant_id
    and stock.location_id = target_location_id
    and stock.product_id in (
      select (item ->> 'productId')::uuid from jsonb_array_elements(target_items) item
    )
  for share;

  for requested_item in select value from jsonb_array_elements(target_items)
  loop
    select value into product
    from jsonb_array_elements(publication.snapshot -> 'products')
    where value ->> 'id' = requested_item ->> 'productId';
    if product is null then
      raise exception 'product is not in the current catalog' using errcode = 'PT104';
    end if;
    if exists (
      select 1 from private.catalog_product_availability availability
      where availability.tenant_id = target_tenant_id
        and availability.location_id = target_location_id
        and availability.product_id = (requested_item ->> 'productId')::uuid
        and not availability.is_available
    ) then
      raise exception 'product is unavailable' using errcode = 'PT104';
    end if;

    variant := null;
    variant_title := null;
    if requested_item -> 'variantId' <> 'null'::jsonb then
      select value into variant
      from jsonb_array_elements(product -> 'variants')
      where value ->> 'id' = requested_item ->> 'variantId';
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
    total := total + unit_price * (requested_item ->> 'quantity')::integer;

    insert into private.order_intent_items (
      tenant_id, location_id, intent_id, line_id, product_id, variant_id,
      production_sector_id, title, variant_title, quantity,
      unit_price_cents, total_cents
    ) values (
      target_tenant_id, target_location_id, intent_id,
      (requested_item ->> 'lineId')::uuid,
      (requested_item ->> 'productId')::uuid,
      nullif(requested_item ->> 'variantId', '')::uuid,
      (product ->> 'sectorId')::uuid,
      product_title, variant_title,
      (requested_item ->> 'quantity')::integer,
      unit_price,
      unit_price * (requested_item ->> 'quantity')::integer
    );

    quoted_items := quoted_items || jsonb_build_array(jsonb_build_object(
      'lineId', requested_item ->> 'lineId',
      'productId', requested_item ->> 'productId',
      'variantId', requested_item -> 'variantId',
      'quantity', (requested_item ->> 'quantity')::integer,
      'status', 'available',
      'title', product_title,
      'variantTitle', variant_title,
      'unitPriceCents', unit_price,
      'totalCents', unit_price * (requested_item ->> 'quantity')::integer
    ));
  end loop;

  for stock_row in
    select stock.product_id, stock.available_quantity,
      sum((item ->> 'quantity')::integer)::integer as requested_quantity
    from private.product_operational_stock stock
    join jsonb_array_elements(target_items) item
      on (item ->> 'productId')::uuid = stock.product_id
    where stock.tenant_id = target_tenant_id
      and stock.location_id = target_location_id
    group by stock.product_id, stock.available_quantity
  loop
    if stock_row.requested_quantity > stock_row.available_quantity then
      raise exception 'insufficient operational stock' using errcode = 'PT106';
    end if;
  end loop;

  insert into private.order_intents (
    id, tenant_id, location_id, table_id, group_id, command_id,
    attribution, diner_name, seat_label, payment_method, payment_path,
    status, catalog_revision, total_cents
  ) values (
    intent_id, target_tenant_id, target_location_id, entry.table_id,
    entry.group_id, target_command_id, target_attribution, target_diner_name,
    target_seat_label, target_payment_method, target_payment_path,
    case when target_payment_path = 'online' then 'payment_pending' else 'awaiting_waiter' end,
    publication.revision, total
  );

  if target_payment_path = 'in_person' then
    call_id := gen_random_uuid();
    insert into private.waiter_calls (
      id, tenant_id, location_id, table_id, intent_id, reason, payment_method
    ) values (
      call_id, target_tenant_id, target_location_id, entry.table_id,
      intent_id, 'order_validation', target_payment_method
    );
  end if;

  command_row.result := jsonb_build_object(
    'intentId', intent_id,
    'callId', call_id,
    'status', case when target_payment_path = 'online' then 'payment_pending' else 'awaiting_waiter' end,
    'items', quoted_items,
    'totalCents', total
  );
  update private.order_intent_commands command
  set result = command_row.result
  where command.tenant_id = target_tenant_id
    and command.location_id = target_location_id
    and command.command_id = target_command_id;
  return command_row.result;
end;
$$;

revoke all on function private.list_public_payment_methods(uuid, uuid)
  from public, anon, authenticated;
revoke all on function private.create_order_intent(uuid, uuid, text, uuid, text, text, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function private.list_public_payment_methods(uuid, uuid) to authenticator;
grant execute on function private.create_order_intent(uuid, uuid, text, uuid, text, text, text, text, text, jsonb)
  to authenticator;

commit;
