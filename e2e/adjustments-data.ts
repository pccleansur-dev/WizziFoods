import postgres from "postgres";

import { hashStaffPin } from "../apps/api/src/staff-auth/pin-credential";
import { PaymentSecretSealer } from "../apps/api/src/payment-methods/payment-secret-sealer";
import { adminDatabaseUrl, ownerDatabaseUrl } from "./stack-env";

export const adjustmentsHostname = "e2e-adjustments.localhost";
export const adjustmentsSlug = "e2e-adjustments";
export const adjustmentsPin = "246810";
const pepper = "e2e-pepper-with-at-least-32-characters";

const tenantId = "1d000000-0000-4000-8000-000000000013";
const userId = "1d000000-0000-4000-8000-000000000011";

const level = "1d100000-0000-4000-8000-0000000000f1";
const sectorSalon = "1d100000-0000-4000-8000-000000000001";
const tableFive = "1d200000-0000-4000-8000-000000000005";
const tableSix = "1d200000-0000-4000-8000-000000000006";
const category = "1d500000-0000-4000-8000-000000000001";
const kitchenSector = "1d500000-0000-4000-8000-000000000002";
const barSector = "1d500000-0000-4000-8000-000000000004";
const products = {
  cerveza: "1d500000-0000-4000-8000-000000000005",
  milanesa: "1d500000-0000-4000-8000-000000000003",
  pollo: "1d500000-0000-4000-8000-000000000007",
  vino: "1d500000-0000-4000-8000-000000000006"
} as const;

export type ProductKey = keyof typeof products;

function tableRow(id: string, label: string, x: number) {
  return {
    floorId: level,
    height: 100,
    id,
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
  tables: [tableRow(tableFive, "5", 40), tableRow(tableSix, "6", 200)]
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
    product(products.cerveza, "Cerveza", barSector, 1, 4_000),
    product(products.vino, "Vino", barSector, 2, 6_900),
    product(products.pollo, "Pollo", kitchenSector, 3, 9_000)
  ],
  sectors: [
    { id: kitchenSector, kind: "kitchen", name: "Cocina", position: 0 },
    { id: barSector, kind: "bar", name: "Barra", position: 1 }
  ]
};

export type AdjustmentsBusiness = {
  close(): Promise<void>;
  /** Adjustments of the business by kind and status. */
  adjustments(): Promise<
    { difference: number; kind: string; status: string }[]
  >;
  /** Ledger movements of the business, oldest first. */
  entries(): Promise<{ amount: number; kind: string }[]>;
  /** Confirms an order of the given products on table 5 or 6, as the manager. */
  placeOrder(table: "5" | "6", items: ProductKey[]): Promise<string>;
  /** Public token for the table-five diner journey. */
  token: string;
  latestOnlinePayment(): Promise<{
    orderId: string;
    paymentId: string;
    refundedCents: number;
    sessionId: string;
  }>;
  /** Cancels the first item of an order, as the manager (leaves a credit when paid). */
  cancelFirstItem(orderId: string): Promise<void>;
  /** Register closures by difference, oldest first. */
  closures(): Promise<
    {
      counted: number;
      difference: number;
      expected: number;
      reason: string | null;
    }[]
  >;
};

async function cleanup(sql: postgres.Sql, owner: postgres.Sql) {
  await owner.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    for (const table of [
      "mp_webhook_events",
      "online_payments",
      "cash_movements",
      "cash_shift_closures",
      "cash_shifts",
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
    "mp_oauth_states",
    "mp_connections",
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

/** A published business with a waiter, a manager, a cook and a bartender. */
export async function seedAdjustmentsBusiness({
  openRegister = true
}: { openRegister?: boolean } = {}): Promise<AdjustmentsBusiness> {
  const sql = postgres(adminDatabaseUrl(), { prepare: false });
  const owner = postgres(ownerDatabaseUrl(), { prepare: false });
  await cleanup(sql, owner);
  await sql`insert into auth.users (id) values (${userId})`;
  await sql`
    insert into public.tenants (id, slug, name, status)
    values (${tenantId}, ${adjustmentsSlug}, 'Ajustes E2E', 'active')
  `;
  await sql`
    insert into public.tenant_memberships (tenant_id, user_id, role)
    values (${tenantId}, ${userId}, 'admin')
  `;
  await sql`
    insert into public.tenant_domains (tenant_id, hostname, kind, status, is_primary)
    values (${tenantId}, ${adjustmentsHostname}, 'platform_subdomain', 'active', true)
  `;
  const [location] = await sql<{ id: string }[]>`
    select id from public.locations where tenant_id = ${tenantId}
  `;
  const locationId = location!.id;
  await sql`
    select private.save_floor_plan(
      ${tenantId}::uuid, ${locationId}::uuid, ${userId}::uuid,
      '1d400000-0000-4000-8000-000000000001'::uuid, 0, ${sql.json(plan)}
    )
  `;
  const [qr] = await sql<{ token: string }[]>`
    select token from private.list_floor_table_qr_codes(
      ${tenantId}::uuid, ${locationId}::uuid, ${userId}::uuid
    ) where label = '5'
  `;
  await sql`
    insert into private.location_publications (tenant_id, location_id, published_by)
    values (${tenantId}, ${locationId}, ${userId})
  `;
  await sql`select private.ensure_payment_methods(${tenantId}::uuid, ${locationId}::uuid)`;
  const sealer = new PaymentSecretSealer(Buffer.alloc(32));
  const sealed = sealer.seal(
    JSON.stringify({
      accessToken: "TEST-24681012-aabbccddeeff",
      expiresAt: "2099-01-01T00:00:00.000Z",
      refreshToken: "TESTREFRESH-24681012-aabbccddeeff"
    }),
    { locationId, tenantId },
    "mercado_pago"
  );
  await sql`
    select private.finish_mp_connection(
      ${tenantId}::uuid, ${locationId}::uuid, ${userId}::uuid,
      '24681012', false, 'TEST-public-key-24681012',
      ${sealed.ciphertext}, ${sealed.keyVersion}
    )
  `;
  await sql`
    update private.payment_methods set enabled = true
    where tenant_id = ${tenantId} and location_id = ${locationId}
      and method_key = 'mercado_pago'
  `;
  await owner`
    insert into private.published_catalogs (
      tenant_id, location_id, revision, source_draft_revision, snapshot, published_by
    ) values (${tenantId}, ${locationId}, 1, 1, ${sql.json(catalog)}, ${userId})
  `;

  const hash = await hashStaffPin(adjustmentsPin, pepper);
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
  const [manager] = await sql<{ id: string }[]>`
    select id from public.staff_members
    where tenant_id = ${tenantId} and username = 'marta'
  `;
  // Collecting needs an open register (T23); the register journey opens it itself.
  if (openRegister) {
    await sql`
      select private.open_cash_shift(
        ${tenantId}::uuid, ${locationId}::uuid, ${manager!.id}::uuid,
        gen_random_uuid(), 0
      )
    `;
  }

  return {
    token: qr!.token,
    async adjustments() {
      const rows = await owner<
        { difference: number; kind: string; status: string }[]
      >`
        select kind, status, difference_cents as difference
        from private.order_adjustments
        where tenant_id = ${tenantId}
        order by created_at, id
      `;
      return [...rows];
    },
    async entries() {
      const rows = await owner<{ amount: number; kind: string }[]>`
        select kind, amount_cents as amount from private.account_entries
        where tenant_id = ${tenantId}
        order by id
      `;
      return [...rows];
    },
    async latestOnlinePayment() {
      const [row] = await owner<
        {
          order_id: string;
          id: string;
          refunded_cents: number;
          session_id: string;
        }[]
      >`
        select id, order_id, refunded_cents, session_id
        from private.online_payments
        where tenant_id = ${tenantId} and status = 'approved'
        order by created_at desc limit 1
      `;
      return {
        orderId: row!.order_id,
        paymentId: row!.id,
        refundedCents: row!.refunded_cents,
        sessionId: row!.session_id
      };
    },
    async cancelFirstItem(orderId) {
      const [item] = await owner<{ line_id: string }[]>`
        select line_id from private.confirmed_order_items
        where tenant_id = ${tenantId} and order_id = ${orderId}
        order by position limit 1
      `;
      await sql`
        select private.cancel_order_item(
          ${tenantId}::uuid, ${locationId}::uuid, ${manager!.id}::uuid,
          gen_random_uuid(), ${orderId}::uuid, ${item!.line_id}::uuid, 'Se terminó'
        )
      `;
    },
    async closures() {
      const rows = await owner<
        {
          counted: number;
          difference: number;
          expected: number;
          reason: string | null;
        }[]
      >`
        select counted_cash_cents as counted, difference_cents as difference,
               expected_cash_cents as expected, reason
        from private.cash_shift_closures
        where tenant_id = ${tenantId}
        order by closed_at
      `;
      return [...rows];
    },
    async close() {
      await cleanup(sql, owner);
      await sql.end();
      await owner.end();
    },
    async placeOrder(table, items) {
      const lines = items.map((key, index) => ({
        lineId: `1d600000-0000-4000-8000-${String(Date.now() % 1e9).padStart(9, "0")}${String(index).padStart(3, "0")}`,
        productId: products[key],
        quantity: 1,
        variantId: null
      }));
      const [row] = await sql<{ result: { orderId: string } }[]>`
        select private.create_manual_order(
          ${tenantId}::uuid, ${locationId}::uuid, ${manager!.id}::uuid,
          gen_random_uuid(), ${table === "5" ? tableFive : tableSix}::uuid,
          'table', null, null, ${sql.json(lines)}
        ) as result
      `;
      return row!.result.orderId;
    }
  };
}
