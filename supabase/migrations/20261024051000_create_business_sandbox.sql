begin;

-- Test mode for the sign-up (T15).
-- The simulated circuit (QR -> order -> production -> payment -> close ->
-- cleanup) lives in its own tables. Nothing in real operation references them,
-- they hold no credentials and every reference carries the SBX- mark. The
-- simulation reads the floor plan and the published catalog but never writes
-- to them, to payment_methods, to staff or to tenant state. Its audit events
-- use the 'sandbox.' action prefix so metrics and reports can exclude them.

create table private.sandbox_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  location_id uuid not null,
  namespace text not null default 'sandbox' check (namespace = 'sandbox'),
  reference text not null check (reference ~ '^SBX-[0-9A-Z]{4,12}$'),
  started_by uuid not null,
  started_at timestamptz not null default now(),
  cleaned_at timestamptz,
  foreign key (tenant_id, location_id)
    references public.locations(tenant_id, id)
    on delete cascade,
  unique (tenant_id, location_id, reference)
);

create table private.sandbox_steps (
  run_id uuid not null references private.sandbox_runs(id) on delete cascade,
  position smallint not null check (position between 1 and 6),
  step text not null check (
    step in (
      'qr_scanned', 'order_placed', 'in_production',
      'payment_recorded', 'closed', 'cleaned_up'
    )
  ),
  ok boolean not null,
  recorded_at timestamptz not null default now(),
  primary key (run_id, position)
);

create table private.sandbox_orders (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references private.sandbox_runs(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  location_id uuid not null,
  reference text not null check (reference ~ '^SBX-[0-9A-Z]{4,12}$'),
  table_id uuid not null,
  status text not null default 'placed' check (
    status in ('placed', 'in_production', 'paid', 'closed')
  ),
  items jsonb not null check (jsonb_typeof(items) = 'array'),
  sector_id uuid,
  total_cents integer not null check (total_cents >= 0),
  paid_cents integer not null default 0 check (paid_cents >= 0),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, location_id)
    references public.locations(tenant_id, id)
    on delete cascade,
  constraint sandbox_orders_paid_before_close check (
    status not in ('paid', 'closed') or paid_cents >= total_cents
  )
);

create index sandbox_orders_scope_idx
  on private.sandbox_orders (tenant_id, location_id);

revoke all on table
  private.sandbox_runs, private.sandbox_steps, private.sandbox_orders
from public, anon, authenticated, authenticator;

create or replace function private.record_sandbox_step(
  target_run_id uuid,
  target_position smallint,
  target_step text
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
set row_security = off
as $$
  insert into private.sandbox_steps (run_id, position, step, ok)
  values (target_run_id, target_position, target_step, true)
  returning jsonb_build_object('ok', ok, 'step', step);
$$;

-- Walks the full circuit and cleans up, all in one transaction.
create or replace function private.run_sandbox_simulation(
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
declare
  missing text[] := '{}';
  published_snapshot jsonb;
  product jsonb;
  chosen_table uuid;
  chosen_qr uuid;
  run_row private.sandbox_runs%rowtype;
  order_row private.sandbox_orders%rowtype;
  reference_code text;
  steps jsonb := '[]'::jsonb;
begin
  perform private.require_floor_plan_admin(
    target_tenant_id, target_location_id, target_requester_id
  );

  select floor_table.id, qr.id
  into chosen_table, chosen_qr
  from private.floor_tables floor_table
  join private.floor_table_qr_codes qr
    on qr.tenant_id = floor_table.tenant_id
   and qr.location_id = floor_table.location_id
   and qr.table_id = floor_table.id
   and qr.status = 'active'
  where floor_table.tenant_id = target_tenant_id
    and floor_table.location_id = target_location_id
    and floor_table.retired_at is null
  order by floor_table.id
  limit 1;
  if chosen_table is null then
    missing := array_append(missing, 'FLOOR_TABLE_WITHOUT_QR');
  end if;

  select published.snapshot -> 'products' -> 0
  into product
  from private.published_catalogs published
  where published.tenant_id = target_tenant_id
    and published.location_id = target_location_id
  order by published.revision desc
  limit 1;
  if product is null then
    missing := array_append(missing, 'CATALOG_NOT_PUBLISHED');
  end if;

  if cardinality(missing) > 0 then
    raise exception 'sandbox prerequisites missing: %',
      array_to_string(missing, ',')
      using errcode = 'PT102';
  end if;

  reference_code := 'SBX-' || upper(substr(md5(gen_random_uuid()::text), 1, 8));
  insert into private.sandbox_runs (
    tenant_id, location_id, reference, started_by
  ) values (
    target_tenant_id, target_location_id, reference_code, target_requester_id
  )
  returning * into run_row;

  -- 1. The diner scans the table QR (only its stable id is kept, never the token).
  steps := steps || private.record_sandbox_step(run_row.id, 1::smallint, 'qr_scanned');

  -- 2. The order is placed with the first published product.
  insert into private.sandbox_orders (
    run_id, tenant_id, location_id, reference, table_id, items, sector_id,
    total_cents
  ) values (
    run_row.id, target_tenant_id, target_location_id, reference_code,
    chosen_table,
    jsonb_build_array(jsonb_build_object(
      'productId', product ->> 'id', 'quantity', 1
    )),
    (product ->> 'sectorId')::uuid,
    (product ->> 'priceCents')::integer
  )
  returning * into order_row;
  steps := steps || private.record_sandbox_step(run_row.id, 2::smallint, 'order_placed');

  -- 3. The production sector receives it.
  update private.sandbox_orders set status = 'in_production'
  where id = order_row.id and sector_id is not null;
  if not found then
    raise exception 'sandbox order has no production sector' using errcode = 'PT102';
  end if;
  steps := steps || private.record_sandbox_step(run_row.id, 3::smallint, 'in_production');

  -- 4. A simulated payment settles it; no payment method or credential is used.
  update private.sandbox_orders
  set paid_cents = total_cents, status = 'paid'
  where id = order_row.id and status = 'in_production';
  steps := steps || private.record_sandbox_step(run_row.id, 4::smallint, 'payment_recorded');

  -- 5. The table is closed.
  update private.sandbox_orders set status = 'closed'
  where id = order_row.id and status = 'paid';
  steps := steps || private.record_sandbox_step(run_row.id, 5::smallint, 'closed');

  -- 6. Cleanup: simulated data disappears, only the step history remains.
  delete from private.sandbox_orders where run_id = run_row.id;
  update private.sandbox_runs set cleaned_at = now() where id = run_row.id;
  steps := steps || private.record_sandbox_step(run_row.id, 6::smallint, 'cleaned_up');

  perform private.append_audit_event(
    target_tenant_id, 'tenant_admin', target_requester_id,
    'sandbox.run_completed', 'Simulación de prueba completada y limpiada',
    gen_random_uuid()::text, 'sandbox_run', run_row.id
  );

  return jsonb_build_object(
    'namespace', run_row.namespace,
    'reference', run_row.reference,
    'runId', run_row.id,
    'steps', steps
  );
end;
$$;

-- Removes simulated leftovers of the location (for example after an interrupted run).
create or replace function private.cleanup_sandbox(
  target_tenant_id uuid,
  target_location_id uuid,
  target_requester_id uuid
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
declare
  removed integer;
begin
  perform private.require_floor_plan_admin(
    target_tenant_id, target_location_id, target_requester_id
  );

  delete from private.sandbox_orders
  where tenant_id = target_tenant_id and location_id = target_location_id;
  get diagnostics removed = row_count;

  update private.sandbox_runs set cleaned_at = now()
  where tenant_id = target_tenant_id
    and location_id = target_location_id
    and cleaned_at is null;

  if removed > 0 then
    perform private.append_audit_event(
      target_tenant_id, 'tenant_admin', target_requester_id,
      'sandbox.cleanup_completed', 'Datos simulados eliminados',
      gen_random_uuid()::text, 'location', target_location_id
    );
  end if;
  return removed;
end;
$$;

revoke all on function
  private.record_sandbox_step(uuid, smallint, text),
  private.run_sandbox_simulation(uuid, uuid, uuid),
  private.cleanup_sandbox(uuid, uuid, uuid)
from public, anon, authenticated;

grant execute on function
  private.run_sandbox_simulation(uuid, uuid, uuid),
  private.cleanup_sandbox(uuid, uuid, uuid)
to authenticator;

commit;
