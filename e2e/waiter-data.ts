import postgres from "postgres";

import { hashStaffPin } from "../apps/api/src/staff-auth/pin-credential";
import { adminDatabaseUrl, ownerDatabaseUrl } from "./stack-env";

export const waiterHostname = "e2e-waiter.localhost";
export const waiterSlug = "e2e-waiter";
export const otherWaiterHostname = "e2e-waiter-other.localhost";
export const otherWaiterSlug = "e2e-waiter-other";
export const staffPin = "246810";
const pepper = "e2e-pepper-with-at-least-32-characters";

const tenantId = "fc000000-0000-4000-8000-000000000013";
const userId = "fc000000-0000-4000-8000-000000000011";
const otherTenantId = "fc000000-0000-4000-8000-000000000023";
const otherUserId = "fc000000-0000-4000-8000-000000000021";

const level = "fc100000-0000-4000-8000-0000000000f1";
const sectorMain = "fc100000-0000-4000-8000-000000000001";
const sectorTerrace = "fc100000-0000-4000-8000-000000000002";
const tableOne = "fc200000-0000-4000-8000-000000000001";
const tableTwo = "fc200000-0000-4000-8000-000000000002";
const tableTerrace = "fc200000-0000-4000-8000-000000000003";
const catalogCategory = "fc500000-0000-4000-8000-000000000001";
const catalogSector = "fc500000-0000-4000-8000-000000000002";
export const catalogProduct = "fc500000-0000-4000-8000-000000000003";

function table(id: string, label: string, sector: string, x: number) {
  return {
    floorId: level,
    height: 100,
    id,
    label,
    rotation: 0,
    seatCount: 4,
    seatLayout: "perimeter",
    sectorId: sector,
    shape: "square",
    width: 100,
    x,
    y: 60
  };
}

const plan = {
  floors: [{ id: level, name: "Salón", position: 0, shortName: null }],
  groups: [],
  sectors: [
    { id: sectorMain, name: "Principal", position: 0 },
    { id: sectorTerrace, name: "Terraza", position: 1 }
  ],
  tables: [
    table(tableOne, "1", sectorMain, 40),
    table(tableTwo, "2", sectorMain, 200),
    table(tableTerrace, "3", sectorTerrace, 360)
  ]
};

const catalog = {
  baseRevision: null,
  categories: [
    {
      content: [{ description: "", language: "es", title: "Principales" }],
      id: catalogCategory,
      position: 0
    }
  ],
  products: [
    {
      categoryId: catalogCategory,
      content: [
        { description: "Con papas doradas", language: "es", title: "Milanesa" }
      ],
      id: catalogProduct,
      imageAssetId: null,
      position: 0,
      priceCents: 12_500,
      sectorId: catalogSector,
      variants: []
    }
  ],
  sectors: [{ id: catalogSector, kind: "kitchen", name: "Cocina", position: 0 }]
};

export type WaiterBusiness = {
  close(): Promise<void>;
  /** Everything the confirmation of T19 must NOT create. */
  forbiddenArtifacts(): Promise<string[]>;
  orderCounts(): Promise<{ confirmed: number; manual: number }>;
  intentStatus(dinerName: string): Promise<string | null>;
  tableStateRows(): Promise<number>;
  tokens: Map<string, string>;
};

async function cleanup(sql: postgres.Sql, owner: postgres.Sql) {
  for (const [tenant, user] of [
    [tenantId, userId],
    [otherTenantId, otherUserId]
  ] as const) {
    await owner`alter table private.confirmed_order_items disable trigger confirmed_order_items_append_only`;
    await owner`alter table private.confirmed_order_items disable trigger confirmed_order_items_no_truncate`;
    await owner`alter table private.confirmed_orders disable trigger confirmed_orders_append_only`;
    await owner`alter table private.confirmed_orders disable trigger confirmed_orders_no_truncate`;
    await owner`alter table private.order_intent_decisions disable trigger order_intent_decisions_append_only`;
    await owner`alter table private.order_intents disable trigger order_intents_guard_change`;
    try {
      await owner`delete from private.confirmed_order_items where tenant_id = ${tenant}`;
      await owner`delete from private.confirmed_orders where tenant_id = ${tenant}`;
      await owner`delete from private.order_intent_decisions where tenant_id = ${tenant}`;
      await owner`delete from private.waiter_commands where tenant_id = ${tenant}`;
      await owner`delete from private.waiter_calls where tenant_id = ${tenant}`;
      await owner`delete from private.order_intent_items where tenant_id = ${tenant}`;
      await owner`delete from private.order_intents where tenant_id = ${tenant}`;
      await owner`delete from private.order_intent_commands where tenant_id = ${tenant}`;
    } finally {
      await owner`alter table private.confirmed_order_items enable trigger confirmed_order_items_append_only`;
      await owner`alter table private.confirmed_order_items enable trigger confirmed_order_items_no_truncate`;
      await owner`alter table private.confirmed_orders enable trigger confirmed_orders_append_only`;
      await owner`alter table private.confirmed_orders enable trigger confirmed_orders_no_truncate`;
      await owner`alter table private.order_intent_decisions enable trigger order_intent_decisions_append_only`;
      await owner`alter table private.order_intents enable trigger order_intents_guard_change`;
    }
    await owner`delete from private.published_catalogs where tenant_id = ${tenant}`;
    await sql`delete from private.location_publications where tenant_id = ${tenant}`;
    await sql`delete from private.audit_events where tenant_id = ${tenant}`;
    await sql`delete from public.tenants where id = ${tenant}`;
    await sql`delete from auth.users where id = ${user}`;
  }
}

/** A published business with two waiters in different sectors, a manager and a cook. */
export async function seedWaiterBusiness(): Promise<WaiterBusiness> {
  const sql = postgres(adminDatabaseUrl(), { prepare: false });
  const owner = postgres(ownerDatabaseUrl(), { prepare: false });
  await cleanup(sql, owner);
  for (const [tenant, user, host, slug] of [
    [tenantId, userId, waiterHostname, waiterSlug],
    [otherTenantId, otherUserId, otherWaiterHostname, otherWaiterSlug]
  ] as const) {
    await sql`insert into auth.users (id) values (${user})`;
    await sql`
      insert into public.tenants (id, slug, name, status)
      values (${tenant}, ${slug}, 'Salón E2E', 'active')
    `;
    await sql`
      insert into public.tenant_memberships (tenant_id, user_id, role)
      values (${tenant}, ${user}, 'admin')
    `;
    await sql`
      insert into public.tenant_domains (tenant_id, hostname, kind, status, is_primary)
      values (${tenant}, ${host}, 'platform_subdomain', 'active', true)
    `;
  }
  const [location] = await sql<{ id: string }[]>`
    select id from public.locations where tenant_id = ${tenantId}
  `;
  const [otherLocation] = await sql<{ id: string }[]>`
    select id from public.locations where tenant_id = ${otherTenantId}
  `;
  const locationId = location!.id;
  await sql`
    select private.save_floor_plan(
      ${tenantId}::uuid, ${locationId}::uuid, ${userId}::uuid,
      'fc400000-0000-4000-8000-000000000001'::uuid, 0, ${sql.json(plan)}
    )
  `;
  const rows = await sql<{ label: string; token: string }[]>`
    select label, token
    from private.list_floor_table_qr_codes(
      ${tenantId}::uuid, ${locationId}::uuid, ${userId}::uuid
    )
  `;
  await sql`
    insert into private.location_publications (tenant_id, location_id, published_by)
    values (${tenantId}, ${locationId}, ${userId})
  `;
  await sql`select private.ensure_payment_methods(${tenantId}::uuid, ${locationId}::uuid)`;
  await sql`
    update private.payment_methods
    set enabled = true, public_config = '{"publicKey":"E2E_PUBLIC_KEY"}'
    where tenant_id = ${tenantId} and location_id = ${locationId}
      and method_key = 'mercado_pago'
  `;
  await sql`
    insert into private.payment_method_secrets
      (tenant_id, location_id, method_key, ciphertext, key_version)
    values (${tenantId}, ${locationId}, 'mercado_pago', decode(repeat('ab', 29), 'hex'), 1)
  `;
  await owner`
    insert into private.published_catalogs (
      tenant_id, location_id, revision, source_draft_revision, snapshot, published_by
    ) values (${tenantId}, ${locationId}, 1, 1, ${sql.json(catalog)}, ${userId})
  `;

  const hash = await hashStaffPin(staffPin, pepper);
  for (const [name, role, sectors] of [
    ["ana", "waiter", [sectorMain]],
    ["bruno", "waiter", [sectorMain]],
    ["carla", "waiter", [sectorTerrace]],
    ["marta", "manager", []],
    ["coco", "kitchen", []]
  ] as const) {
    await sql`
      select private.create_staff_member(
        ${tenantId}::uuid, ${locationId}::uuid, ${userId}::uuid,
        ${name}, ${name}, ${role}, ${hash}, ${[...sectors]}::uuid[]
      )
    `;
  }
  await sql`
    insert into public.staff_members (tenant_id, location_id, username, display_name, role, created_by)
    values (${otherTenantId}, ${otherLocation!.id}, 'otra', 'Otra', 'waiter', ${otherUserId})
  `;

  return {
    async close() {
      await cleanup(sql, owner);
      await sql.end();
      await owner.end();
    },
    async forbiddenArtifacts() {
      const found = await sql<{ table_name: string }[]>`
        select table_name from information_schema.tables
        where table_schema = 'private'
          and table_name ~ '(ledger|payment_transaction|production|kds)'
      `;
      return found.map((row) => row.table_name);
    },
    async intentStatus(dinerName) {
      const [row] = await owner<{ status: string }[]>`
        select status from private.order_intents
        where tenant_id = ${tenantId} and diner_name = ${dinerName}
        order by created_at desc limit 1
      `;
      return row?.status ?? null;
    },
    async orderCounts() {
      const [row] = await owner<{ confirmed: number; manual: number }[]>`
        select
          count(*) filter (where source = 'intent')::integer as confirmed,
          count(*) filter (where source = 'manual')::integer as manual
        from private.confirmed_orders where tenant_id = ${tenantId}
      `;
      return row ?? { confirmed: 0, manual: 0 };
    },
    async tableStateRows() {
      const [row] = await owner<{ count: number }[]>`
        select count(*)::integer as count from private.floor_table_service_states
        where tenant_id = ${tenantId}
      `;
      return row?.count ?? 0;
    },
    tokens: new Map(rows.map((row) => [row.label, row.token]))
  };
}
