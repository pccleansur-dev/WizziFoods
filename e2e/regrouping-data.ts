import postgres from "postgres";

import { hashStaffPin } from "../apps/api/src/staff-auth/pin-credential";
import { adminDatabaseUrl, ownerDatabaseUrl } from "./stack-env";

export const regroupingHostname = "e2e-regroup.localhost";
export const regroupingSlug = "e2e-regroup";
export const regroupingPin = "246810";
const pepper = "e2e-pepper-with-at-least-32-characters";

const tenantId = "5e000000-0000-4000-8000-000000000013";
const userId = "5e000000-0000-4000-8000-000000000011";

const level = "5e100000-0000-4000-8000-0000000000f1";
const sectorSalon = "5e100000-0000-4000-8000-000000000001";
const tableIds = {
  "1": "5e200000-0000-4000-8000-000000000001",
  "2": "5e200000-0000-4000-8000-000000000002",
  "3": "5e200000-0000-4000-8000-000000000003",
  "4": "5e200000-0000-4000-8000-000000000004"
} as const;
const category = "5e500000-0000-4000-8000-000000000001";
const kitchenSector = "5e500000-0000-4000-8000-000000000002";
const barSector = "5e500000-0000-4000-8000-000000000004";
const products = {
  cerveza: "5e500000-0000-4000-8000-000000000005",
  milanesa: "5e500000-0000-4000-8000-000000000003"
} as const;

export type RegroupingTable = keyof typeof tableIds;
export type RegroupingProduct = keyof typeof products;

function tableRow(label: RegroupingTable, x: number) {
  return {
    floorId: level,
    height: 100,
    id: tableIds[label],
    label,
    rotation: 0,
    seatCount: 4,
    seatLayout: "perimeter",
    sectorId: sectorSalon,
    shape: "square",
    width: 100,
    x,
    y: 60
  };
}

const plan = {
  floors: [{ id: level, name: "Salón", position: 0, shortName: null }],
  groups: [],
  sectors: [{ id: sectorSalon, name: "Principal", position: 0 }],
  tables: [
    tableRow("1", 40),
    tableRow("2", 200),
    tableRow("3", 360),
    tableRow("4", 520)
  ]
};

function product(
  id: string,
  title: string,
  sector: string,
  position: number,
  priceCents: number
) {
  return {
    categoryId: category,
    content: [{ description: "", language: "es", title }],
    id,
    imageAssetId: null,
    position,
    priceCents,
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
    product(products.milanesa, "Milanesa", kitchenSector, 0, 12_500),
    product(products.cerveza, "Cerveza", barSector, 1, 4_000)
  ],
  sectors: [
    { id: kitchenSector, kind: "kitchen", name: "Cocina", position: 0 },
    { id: barSector, kind: "bar", name: "Barra", position: 1 }
  ]
};

export type RegroupingBusiness = {
  close(): Promise<void>;
  /** The QR token of a table, as a diner scans it. */
  dinerToken(table: RegroupingTable): Promise<string>;
  /** `count:sum` of the ledger and the tables of every order: must not move. */
  fingerprint(): Promise<string>;
  /** Number of join/separate events recorded for the business. */
  groupEvents(): Promise<number>;
  /** Confirms an order of the given products on a table, as the manager. */
  placeOrder(
    table: RegroupingTable,
    items: RegroupingProduct[]
  ): Promise<string>;
};

async function cleanup(sql: postgres.Sql, owner: postgres.Sql) {
  await owner.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    await tx`delete from private.account_split_assignments where split_id in (select id from private.account_splits where tenant_id = ${tenantId})`;
    await tx`delete from private.account_split_shares where split_id in (select id from private.account_splits where tenant_id = ${tenantId})`;
    for (const table of [
      "table_group_events",
      "mp_webhook_events",
      "online_payments",
      "cashier_requests",
      "account_receipts",
      "receipt_counters",
      "cash_movements",
      "cash_shift_closures",
      "cash_shifts",
      "account_splits",
      "account_entries",
      "account_decisions",
      "table_sessions",
      "order_adjustments",
      "production_item_events",
      "production_items",
      "confirmed_order_items",
      "confirmed_orders",
      "order_intent_decisions",
      "order_intent_items",
      "order_intents"
    ]) {
      await tx`delete from ${tx(`private.${table}`)} where tenant_id = ${tenantId}`;
    }
  });
  for (const table of [
    "waiter_commands",
    "waiter_calls",
    "order_intent_commands",
    "published_catalogs"
  ]) {
    await owner`delete from ${owner(`private.${table}`)} where tenant_id = ${tenantId}`;
  }
  await sql`delete from private.location_publications where tenant_id = ${tenantId}`;
  await sql`delete from private.audit_events where tenant_id = ${tenantId}`;
  await sql`delete from public.tenants where id = ${tenantId}`;
  await sql`delete from auth.users where id = ${userId}`;
}

/** A published business with four tables in one sector, a waiter and a manager. */
export async function seedRegroupingBusiness(): Promise<RegroupingBusiness> {
  const sql = postgres(adminDatabaseUrl(), { prepare: false });
  const owner = postgres(ownerDatabaseUrl(), { prepare: false });
  await cleanup(sql, owner);
  await sql`insert into auth.users (id) values (${userId})`;
  await sql`
    insert into public.tenants (id, slug, name, status)
    values (${tenantId}, ${regroupingSlug}, 'Unir mesas E2E', 'active')
  `;
  await sql`
    insert into public.tenant_memberships (tenant_id, user_id, role)
    values (${tenantId}, ${userId}, 'admin')
  `;
  await sql`
    insert into public.tenant_domains (tenant_id, hostname, kind, status, is_primary)
    values (${tenantId}, ${regroupingHostname}, 'platform_subdomain', 'active', true)
  `;
  const [location] = await sql<{ id: string }[]>`
    select id from public.locations where tenant_id = ${tenantId}
  `;
  const locationId = location!.id;
  await sql`
    select private.save_floor_plan(
      ${tenantId}::uuid, ${locationId}::uuid, ${userId}::uuid,
      '5e400000-0000-4000-8000-000000000001'::uuid, 0, ${sql.json(plan)}
    )
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

  const hash = await hashStaffPin(regroupingPin, pepper);
  for (const [name, role, sectors] of [
    ["ana", "waiter", [sectorSalon]],
    ["marta", "manager", []]
  ] as const) {
    await sql`
      select private.create_staff_member(
        ${tenantId}::uuid, ${locationId}::uuid, ${userId}::uuid,
        ${name}, ${name}, ${role}, ${hash}, ${[...sectors]}::uuid[]
      )
    `;
  }
  const [manager] = await sql<{ id: string }[]>`
    select id from public.staff_members
    where tenant_id = ${tenantId} and username = 'marta'
  `;

  let lineCounter = 0;
  return {
    async dinerToken(table) {
      const [row] = await owner<{ token: string }[]>`
        select token from private.floor_table_qr_codes
        where tenant_id = ${tenantId} and table_id = ${tableIds[table]}
          and status = 'active'
      `;
      return row!.token;
    },
    async fingerprint() {
      const [row] = await owner<{ snapshot: string }[]>`
        select (
          select count(*)::text || ':' || coalesce(sum(amount_cents), 0)::text
          from private.account_entries where tenant_id = ${tenantId}
        ) || '|' || (
          select coalesce(string_agg(
            id::text || table_id::text || coalesce(session_id::text, '-'),
            ',' order by id), '')
          from private.confirmed_orders where tenant_id = ${tenantId}
        ) as snapshot
      `;
      return row!.snapshot;
    },
    async groupEvents() {
      const [row] = await owner<{ total: number }[]>`
        select count(*)::int as total from private.table_group_events
        where tenant_id = ${tenantId}
      `;
      return row!.total;
    },
    async close() {
      await cleanup(sql, owner);
      await sql.end();
      await owner.end();
    },
    async placeOrder(table, items) {
      const lines = items.map((key) => {
        lineCounter += 1;
        return {
          lineId: `5e600000-0000-4000-8000-${String(Date.now() % 1e9).padStart(9, "0")}${String(lineCounter).padStart(3, "0")}`,
          productId: products[key],
          quantity: 1,
          variantId: null
        };
      });
      const [row] = await sql<{ result: { orderId: string } }[]>`
        select private.create_manual_order(
          ${tenantId}::uuid, ${locationId}::uuid, ${manager!.id}::uuid,
          gen_random_uuid(), ${tableIds[table]}::uuid,
          'table', null, null, ${sql.json(lines)}
        ) as result
      `;
      return row!.result.orderId;
    }
  };
}
