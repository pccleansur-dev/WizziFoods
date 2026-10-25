import postgres from "postgres";

import { hashStaffPin } from "../apps/api/src/staff-auth/pin-credential";
import { adminDatabaseUrl, ownerDatabaseUrl } from "./stack-env";

export const productionHostname = "e2e-production.localhost";
export const productionSlug = "e2e-production";
export const productionPin = "246810";
const pepper = "e2e-pepper-with-at-least-32-characters";

const tenantId = "ed000000-0000-4000-8000-000000000013";
const userId = "ed000000-0000-4000-8000-000000000011";

const level = "ed100000-0000-4000-8000-0000000000f1";
const sectorSalon = "ed100000-0000-4000-8000-000000000001";
const tableFive = "ed200000-0000-4000-8000-000000000001";
const category = "ed500000-0000-4000-8000-000000000001";
const kitchenSector = "ed500000-0000-4000-8000-000000000002";
const barSector = "ed500000-0000-4000-8000-000000000004";
const milanesa = "ed500000-0000-4000-8000-000000000003";
const cerveza = "ed500000-0000-4000-8000-000000000005";

const plan = {
  floors: [{ id: level, name: "Salón", position: 0, shortName: null }],
  groups: [],
  sectors: [{ id: sectorSalon, name: "Principal", position: 0 }],
  tables: [
    {
      floorId: level,
      height: 100,
      id: tableFive,
      label: "5",
      rotation: 0,
      seatCount: 4,
      seatLayout: "perimeter",
      sectorId: sectorSalon,
      shape: "square",
      width: 100,
      x: 40,
      y: 60
    }
  ]
};

function product(id: string, title: string, sector: string, position: number) {
  return {
    categoryId: category,
    content: [{ description: "", language: "es", title }],
    id,
    imageAssetId: null,
    position,
    priceCents: 6_000,
    sectorId: sector,
    variants: []
  };
}

const catalog = {
  baseRevision: null,
  categories: [
    {
      content: [{ description: "", language: "es", title: "Todo" }],
      id: category,
      position: 0
    }
  ],
  products: [
    product(milanesa, "Milanesa", kitchenSector, 0),
    product(cerveza, "Cerveza", barSector, 1)
  ],
  sectors: [
    { id: kitchenSector, kind: "kitchen", name: "Cocina", position: 0 },
    { id: barSector, kind: "bar", name: "Barra", position: 1 }
  ]
};

export type ProductionBusiness = {
  close(): Promise<void>;
  /** Production rows and recorded steps of every order of the business. */
  counts(): Promise<{ events: number; items: number }>;
  token: string;
};

async function cleanup(sql: postgres.Sql, owner: postgres.Sql) {
  await owner.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    await tx`delete from private.cash_movements where tenant_id = ${tenantId}`;
    await tx`delete from private.cash_shift_closures where tenant_id = ${tenantId}`;
    await tx`delete from private.cash_shifts where tenant_id = ${tenantId}`;
    await tx`delete from private.account_entries where tenant_id = ${tenantId}`;
    await tx`delete from private.account_decisions where tenant_id = ${tenantId}`;
    await tx`delete from private.table_sessions where tenant_id = ${tenantId}`;
    await tx`delete from private.order_adjustments where tenant_id = ${tenantId}`;
    await tx`delete from private.production_item_events where tenant_id = ${tenantId}`;
    await tx`delete from private.production_items where tenant_id = ${tenantId}`;
    await tx`delete from private.confirmed_order_items where tenant_id = ${tenantId}`;
    await tx`delete from private.confirmed_orders where tenant_id = ${tenantId}`;
    await tx`delete from private.order_intent_decisions where tenant_id = ${tenantId}`;
    await tx`delete from private.order_intent_items where tenant_id = ${tenantId}`;
    await tx`delete from private.order_intents where tenant_id = ${tenantId}`;
  });
  await owner`delete from private.waiter_commands where tenant_id = ${tenantId}`;
  await owner`delete from private.waiter_calls where tenant_id = ${tenantId}`;
  await owner`delete from private.order_intent_commands where tenant_id = ${tenantId}`;
  await owner`delete from private.published_catalogs where tenant_id = ${tenantId}`;
  await sql`delete from private.location_publications where tenant_id = ${tenantId}`;
  await sql`delete from private.audit_events where tenant_id = ${tenantId}`;
  await sql`delete from public.tenants where id = ${tenantId}`;
  await sql`delete from auth.users where id = ${userId}`;
}

/** A published business with a waiter, a cook, a bartender and one table. */
export async function seedProductionBusiness(): Promise<ProductionBusiness> {
  const sql = postgres(adminDatabaseUrl(), { prepare: false });
  const owner = postgres(ownerDatabaseUrl(), { prepare: false });
  await cleanup(sql, owner);
  await sql`insert into auth.users (id) values (${userId})`;
  await sql`
    insert into public.tenants (id, slug, name, status)
    values (${tenantId}, ${productionSlug}, 'Producción E2E', 'active')
  `;
  await sql`
    insert into public.tenant_memberships (tenant_id, user_id, role)
    values (${tenantId}, ${userId}, 'admin')
  `;
  await sql`
    insert into public.tenant_domains (tenant_id, hostname, kind, status, is_primary)
    values (${tenantId}, ${productionHostname}, 'platform_subdomain', 'active', true)
  `;
  const [location] = await sql<{ id: string }[]>`
    select id from public.locations where tenant_id = ${tenantId}
  `;
  const locationId = location!.id;
  await sql`
    select private.save_floor_plan(
      ${tenantId}::uuid, ${locationId}::uuid, ${userId}::uuid,
      'ed400000-0000-4000-8000-000000000001'::uuid, 0, ${sql.json(plan)}
    )
  `;
  const [qr] = await sql<{ token: string }[]>`
    select token
    from private.list_floor_table_qr_codes(
      ${tenantId}::uuid, ${locationId}::uuid, ${userId}::uuid
    )
    where label = '5'
  `;
  await sql`
    insert into private.location_publications (tenant_id, location_id, published_by)
    values (${tenantId}, ${locationId}, ${userId})
  `;
  await sql`select private.ensure_payment_methods(${tenantId}::uuid, ${locationId}::uuid)`;
  await owner`
    insert into private.published_catalogs (
      tenant_id, location_id, revision, source_draft_revision, snapshot, published_by
    ) values (${tenantId}, ${locationId}, 1, 1, ${sql.json(catalog)}, ${userId})
  `;

  const hash = await hashStaffPin(productionPin, pepper);
  for (const [name, role, sectors] of [
    ["ana", "waiter", [sectorSalon]],
    ["marta", "manager", []],
    ["coco", "kitchen", []],
    ["beto", "bar", []]
  ] as const) {
    await sql`
      select private.create_staff_member(
        ${tenantId}::uuid, ${locationId}::uuid, ${userId}::uuid,
        ${name}, ${name}, ${role}, ${hash}, ${[...sectors]}::uuid[]
      )
    `;
  }

  return {
    async close() {
      await cleanup(sql, owner);
      await sql.end();
      await owner.end();
    },
    async counts() {
      const [items] = await owner<{ count: number }[]>`
        select count(*)::integer as count from private.production_items
        where tenant_id = ${tenantId}
      `;
      const [events] = await owner<{ count: number }[]>`
        select count(*)::integer as count from private.production_item_events
        where tenant_id = ${tenantId}
      `;
      return { events: events?.count ?? 0, items: items?.count ?? 0 };
    },
    token: qr!.token
  };
}
