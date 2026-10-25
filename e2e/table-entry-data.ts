import postgres from "postgres";

import { PaymentSecretSealer } from "../apps/api/src/payment-methods/payment-secret-sealer";
import { adminDatabaseUrl, e2eHostname, ownerDatabaseUrl } from "./stack-env";

export const tenantId = "fe000000-0000-4000-8000-000000000013";
export const userId = "fe000000-0000-4000-8000-000000000011";
const otherTenantId = "fe000000-0000-4000-8000-000000000023";
const otherUserId = "fe000000-0000-4000-8000-000000000021";
export const otherHostname = "e2e-other.localhost";

const level = "fe100000-0000-4000-8000-0000000000f1";
const sector = "fe100000-0000-4000-8000-000000000001";
export const tables = {
  broken: "fe200000-0000-4000-8000-000000000005",
  dirty: "fe200000-0000-4000-8000-000000000004",
  free: "fe200000-0000-4000-8000-000000000001",
  mateA: "fe200000-0000-4000-8000-000000000002",
  mateB: "fe200000-0000-4000-8000-000000000003"
};
const group = "fe300000-0000-4000-8000-000000000001";
const catalogCategory = "fe500000-0000-4000-8000-000000000001";
const catalogSector = "fe500000-0000-4000-8000-000000000002";
export const catalogProduct = "fe500000-0000-4000-8000-000000000003";
const catalogVariant = "fe500000-0000-4000-8000-000000000004";

function table(id: string, label: string, x: number) {
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
  floors: [{ id: level, name: "Terraza", position: 0, shortName: null }],
  groups: [
    { id: group, name: "Cumpleaños", tableIds: [tables.mateA, tables.mateB] }
  ],
  sectors: [{ id: sector, name: "Salón", position: 0 }],
  tables: [
    table(tables.free, "5", 40),
    table(tables.mateA, "17", 220),
    table(tables.mateB, "18", 340),
    table(tables.dirty, "9", 460),
    table(tables.broken, "3", 580)
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
        {
          description: "Con papas doradas",
          language: "es",
          title: "Milanesa"
        }
      ],
      id: catalogProduct,
      imageAssetId: null,
      position: 0,
      priceCents: 12_500,
      sectorId: catalogSector,
      variants: [
        {
          content: [{ description: "", language: "es", title: "Napolitana" }],
          id: catalogVariant,
          position: 0,
          priceDeltaCents: 2_500
        }
      ]
    }
  ],
  sectors: [{ id: catalogSector, kind: "kitchen", name: "Cocina", position: 0 }]
};

export type SeededBusiness = {
  /** Token of each table by its label. */
  tokens: Map<string, string>;
  setState(
    tableId: string,
    state: "needs_cleaning" | "occupied" | "out_of_service" | null
  ): Promise<void>;
  setProductAvailable(isAvailable: boolean): Promise<void>;
  intentState(dinerName: string): Promise<{
    calls: number;
    intents: number;
    status: string | null;
  }>;
  close(): Promise<void>;
};

async function cleanup(sql: postgres.Sql, owner: postgres.Sql) {
  for (const [tenant, user] of [
    [tenantId, userId],
    [otherTenantId, otherUserId]
  ] as const) {
    await owner.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`delete from private.mp_webhook_events where tenant_id = ${tenant}`;
      await tx`delete from private.online_payments where tenant_id = ${tenant}`;
      await tx`delete from private.waiter_calls where tenant_id = ${tenant}`;
      await tx`delete from private.order_intent_items where tenant_id = ${tenant}`;
      await tx`delete from private.order_intents where tenant_id = ${tenant}`;
      await tx`delete from private.order_intent_commands where tenant_id = ${tenant}`;
      await tx`delete from private.published_catalogs where tenant_id = ${tenant}`;
    });
    await owner`delete from private.mp_oauth_states where tenant_id = ${tenant}`;
    await owner`delete from private.mp_connections where tenant_id = ${tenant}`;
    await sql`delete from private.location_publications where tenant_id = ${tenant}`;
    await sql`delete from private.audit_events where tenant_id = ${tenant}`;
    await sql`delete from public.tenants where id = ${tenant}`;
    await sql`delete from auth.users where id = ${user}`;
  }
}

/** Creates a published business with tables in every state, plus a second one. */
export async function seedBusiness(): Promise<SeededBusiness> {
  const sql = postgres(adminDatabaseUrl(), { prepare: false });
  const owner = postgres(ownerDatabaseUrl(), { prepare: false });
  await cleanup(sql, owner);
  for (const [tenant, user, host, slug] of [
    [tenantId, userId, e2eHostname, "e2e-entry"],
    [otherTenantId, otherUserId, otherHostname, "e2e-other"]
  ] as const) {
    await sql`insert into auth.users (id) values (${user})`;
    await sql`
      insert into public.tenants (id, slug, name, status)
      values (${tenant}, ${slug}, 'Entrada E2E', 'active')
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
  const locationId = location!.id;
  await sql`
    select private.save_floor_plan(
      ${tenantId}::uuid, ${locationId}::uuid, ${userId}::uuid,
      'fe400000-0000-4000-8000-000000000001'::uuid, 0, ${sql.json(plan)}
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
  const sealed = new PaymentSecretSealer(Buffer.alloc(32)).seal(
    JSON.stringify({
      accessToken: "TEST-13579113-aabbccddeeff", // secret-scan: allow -- fake gateway fixture
      expiresAt: "2099-01-01T00:00:00.000Z",
      refreshToken: "TESTREFRESH-13579113-aabbccddeeff"
    }),
    { locationId, tenantId },
    "mercado_pago"
  );
  await sql`
    select private.finish_mp_connection(
      ${tenantId}::uuid, ${locationId}::uuid, ${userId}::uuid,
      '13579113', false, 'TEST-public-key-13579113',
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

  const business: SeededBusiness = {
    async close() {
      await cleanup(sql, owner);
      await sql.end();
      await owner.end();
    },
    async intentState(dinerName) {
      const [row] = await owner<
        {
          calls: number;
          intents: number;
          status: string | null;
        }[]
      >`
        select count(distinct intent.id)::integer as intents,
          count(call.id)::integer as calls,
          max(intent.status) as status
        from private.order_intents intent
        left join private.waiter_calls call
          on call.tenant_id = intent.tenant_id
          and call.location_id = intent.location_id
          and call.intent_id = intent.id
        where intent.tenant_id = ${tenantId}
          and intent.diner_name = ${dinerName}
      `;
      return row ?? { calls: 0, intents: 0, status: null };
    },
    async setState(tableId, state) {
      await sql`
        delete from private.floor_table_service_states
        where tenant_id = ${tenantId} and table_id = ${tableId}
      `;
      if (state) {
        await sql`
          insert into private.floor_table_service_states
            (tenant_id, location_id, table_id, state)
          values (${tenantId}, ${locationId}, ${tableId}, ${state})
        `;
      }
    },
    async setProductAvailable(isAvailable) {
      await owner`
        insert into private.catalog_product_availability (
          tenant_id, location_id, product_id, is_available, version, updated_by
        ) values (
          ${tenantId}, ${locationId}, ${catalogProduct}, ${isAvailable}, 1, ${userId}
        )
        on conflict (tenant_id, location_id, product_id) do update
        set is_available = excluded.is_available,
            version = private.catalog_product_availability.version + 1,
            updated_by = excluded.updated_by,
            updated_at = now()
      `;
    },
    tokens: new Map(rows.map((row) => [row.label, row.token]))
  };
  await business.setState(tables.mateB, "occupied");
  await business.setState(tables.dirty, "needs_cleaning");
  await business.setState(tables.broken, "out_of_service");
  return business;
}
