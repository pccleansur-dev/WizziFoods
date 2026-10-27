import {
  FastifyAdapter,
  type NestFastifyApplication
} from "@nestjs/platform-fastify";
import { NestFactory } from "@nestjs/core";
import type { ApiRuntimeConfig } from "@platform/config";
import type { InjectOptions } from "fastify";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../app.module.js";
import { hashStaffPin } from "../staff-auth/pin-credential.js";

const databaseUrl = process.env.DATABASE_URL;
const databaseAdminUrl = process.env.DATABASE_ADMIN_URL;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
const hasLocalStack =
  databaseUrl && databaseAdminUrl && supabaseUrl && supabaseSecretKey;
const describeWithLocalStack = hasLocalStack ? describe : describe.skip;

const pepper = "test-pepper-with-at-least-32-characters";
const pin = "135790";

type Fixture = {
  hostname: string;
  slug: string;
  tenantId: string;
  userId: string;
};

const one: Fixture = {
  hostname: "production-one.plataforma.test",
  slug: "production-it-1",
  tenantId: "ee000000-0000-4000-8000-000000000013",
  userId: "ee000000-0000-4000-8000-000000000011"
};
const two: Fixture = {
  hostname: "production-two.plataforma.test",
  slug: "production-it-2",
  tenantId: "ee000000-0000-4000-8000-000000000023",
  userId: "ee000000-0000-4000-8000-000000000021"
};

const level = "ee100000-0000-4000-8000-0000000000f1";
const sectorSalon = "ee100000-0000-4000-8000-000000000001";
const tableMain = "ee200000-0000-4000-8000-000000000001";
const tableOther = "ee200000-0000-4000-8000-000000000009";
const categoryId = "ee300000-0000-4000-8000-000000000003";
const kitchenSector = "ee300000-0000-4000-8000-000000000002";
const barSector = "ee300000-0000-4000-8000-000000000004";
const milanesa = "ee300000-0000-4000-8000-000000000001";
const cerveza = "ee300000-0000-4000-8000-000000000005";

function uuid(seed: number): string {
  return `ff800000-0000-4000-8000-${String(seed).padStart(12, "0")}`;
}

function table(id: string, label: string) {
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
    x: 40,
    y: 60
  };
}

function product(
  id: string,
  title: string,
  sectorId: string,
  position: number
) {
  return {
    categoryId,
    content: [{ description: "", language: "es", title }],
    id,
    imageAssetId: null,
    position,
    priceCents: 5_000,
    sectorId,
    variants: []
  };
}

describeWithLocalStack("production with local Supabase", () => {
  const admin = postgres(databaseAdminUrl ?? "", { prepare: false });
  let app: NestFastifyApplication | undefined;
  let locationOne = "";
  let locationTwo = "";
  const sessions = new Map<string, string>();
  let counter = 100;
  const next = () => uuid(counter++);

  // Triggers stay enabled for everyone else: other integration files assert the
  // append-only guards at the same time, so only this transaction skips them.
  // Tenant cascades are triggers too, so the tenants go in a normal statement.
  async function cleanup() {
    for (const fixture of [one, two]) {
      const tenant = fixture.tenantId;
      await admin.begin(async (tx) => {
        await tx`set local session_replication_role = replica`;
        await tx`delete from private.cash_movements where tenant_id = ${tenant}`;
        await tx`delete from private.cash_shift_closures where tenant_id = ${tenant}`;
        await tx`delete from private.cash_shifts where tenant_id = ${tenant}`;
        await tx`delete from private.account_split_assignments where split_id in (select id from private.account_splits where tenant_id = ${tenant})`;
        await tx`delete from private.account_split_shares where split_id in (select id from private.account_splits where tenant_id = ${tenant})`;
        await tx`delete from private.account_splits where tenant_id = ${tenant}`;
        await tx`delete from private.account_entries where tenant_id = ${tenant}`;
        await tx`delete from private.account_decisions where tenant_id = ${tenant}`;
        await tx`delete from private.table_sessions where tenant_id = ${tenant}`;
        await tx`delete from private.production_item_events where tenant_id = ${tenant}`;
        await tx`delete from private.production_items where tenant_id = ${tenant}`;
        await tx`delete from private.confirmed_order_items where tenant_id = ${tenant}`;
        await tx`delete from private.confirmed_orders where tenant_id = ${tenant}`;
        await tx`delete from private.order_intent_decisions where tenant_id = ${tenant}`;
        await tx`delete from private.order_intent_items where tenant_id = ${tenant}`;
        await tx`delete from private.order_intents where tenant_id = ${tenant}`;
      });
      await admin`delete from private.waiter_commands where tenant_id = ${tenant}`;
      await admin`delete from private.waiter_calls where tenant_id = ${tenant}`;
      await admin`delete from private.order_intent_commands where tenant_id = ${tenant}`;
      await admin`delete from private.product_operational_stock where tenant_id = ${tenant}`;
      await admin`delete from private.audit_events where tenant_id = ${tenant}`;
      await admin`delete from private.published_catalogs where tenant_id = ${tenant}`;
      await admin`delete from private.location_publications where tenant_id = ${tenant}`;
      await admin`delete from public.tenants where id = ${tenant}`;
      await admin`delete from auth.users where id = ${fixture.userId}`;
    }
  }

  async function createStaff(
    fixture: Fixture,
    locationId: string,
    username: string,
    role: string,
    sectors: string[]
  ) {
    const hash = await hashStaffPin(pin, pepper);
    await admin`
      select private.create_staff_member(
        ${fixture.tenantId}::uuid, ${locationId}::uuid, ${fixture.userId}::uuid,
        ${username}, ${username}, ${role}, ${hash}, ${sectors}::uuid[]
      )
    `;
  }

  async function login(fixture: Fixture, username: string) {
    const response = await app!
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "POST",
        payload: { pin, username },
        url: `/v1/tenants/${fixture.slug}/staff-sessions`
      });
    expect(response.statusCode).toBe(201);
    sessions.set(username, response.json().data.accessToken);
  }

  async function staff(
    username: string,
    method: "GET" | "POST",
    url: string,
    payload?: unknown
  ) {
    const options: InjectOptions = {
      headers: { authorization: `Bearer ${sessions.get(username)}` },
      method,
      url
    };
    if (payload !== undefined) options.payload = payload as object;
    const response = await app!.getHttpAdapter().getInstance().inject(options);
    return { body: response.json(), status: response.statusCode };
  }

  type Placed = { barLine: string; kitchenLine: string; orderId: string };

  /** A manual order with one kitchen item and one bar item. */
  async function place(
    commandId = next(),
    lines: [string, string] = [next(), next()]
  ): Promise<Placed> {
    const [kitchenLine, barLine] = lines;
    const response = await staff("ana", "POST", "/v1/staff/orders", {
      attribution: "table",
      commandId,
      dinerName: null,
      items: [
        {
          lineId: kitchenLine,
          productId: milanesa,
          quantity: 2,
          variantId: null
        },
        { lineId: barLine, productId: cerveza, quantity: 1, variantId: null }
      ],
      seatLabel: null,
      tableId: tableMain
    });
    expect(response.status).toBe(201);
    return { barLine, kitchenLine, orderId: response.body.data.orderId };
  }

  const board = (user: string) => staff(user, "GET", "/v1/staff/production");
  const advance = (
    user: string,
    orderId: string,
    lineId: string,
    status: string,
    commandId = next()
  ) =>
    staff(
      user,
      "POST",
      `/v1/staff/production/orders/${orderId}/items/${lineId}/status`,
      { commandId, status }
    );
  const ticketOf = (
    body: {
      data: {
        tickets: {
          items: { title: string }[];
          orderId: string;
          orderStatus: string;
          status: string;
        }[];
      };
    },
    orderId: string
  ) => body.data.tickets.find((ticket) => ticket.orderId === orderId);

  beforeAll(async () => {
    await cleanup();
    for (const fixture of [one, two]) {
      await admin`insert into auth.users (id) values (${fixture.userId})`;
      await admin`
        insert into public.tenants (id, slug, name, status)
        values (${fixture.tenantId}, ${fixture.slug}, 'Production IT', 'active')
      `;
      await admin`
        insert into public.tenant_memberships (tenant_id, user_id, role)
        values (${fixture.tenantId}, ${fixture.userId}, 'admin')
      `;
      await admin`
        insert into public.tenant_domains (
          tenant_id, hostname, kind, status, is_primary
        ) values (
          ${fixture.tenantId}, ${fixture.hostname}, 'platform_subdomain',
          'active', true
        )
      `;
    }
    const [first] = await admin<{ id: string }[]>`
      select id from public.locations where tenant_id = ${one.tenantId}
    `;
    const [second] = await admin<{ id: string }[]>`
      select id from public.locations where tenant_id = ${two.tenantId}
    `;
    locationOne = first!.id;
    locationTwo = second!.id;

    for (const [fixture, location, tableRow] of [
      [one, locationOne, table(tableMain, "1")],
      [two, locationTwo, table(tableOther, "1")]
    ] as const) {
      await admin`
        select private.save_floor_plan(
          ${fixture.tenantId}::uuid, ${location}::uuid, ${fixture.userId}::uuid,
          ${uuid(fixture === one ? 1 : 2)}::uuid, 0, ${admin.json({
            floors: [
              { id: level, name: "Salón", position: 0, shortName: null }
            ],
            groups: [],
            sectors: [{ id: sectorSalon, name: "Salón", position: 0 }],
            tables: [tableRow]
          })}
        )
      `;
    }

    await admin`
      insert into private.location_publications (tenant_id, location_id, published_by)
      values (${one.tenantId}, ${locationOne}, ${one.userId})
    `;
    await admin`
      insert into private.published_catalogs (
        tenant_id, location_id, revision, source_draft_revision, snapshot, published_by
      ) values (
        ${one.tenantId}, ${locationOne}, 1, 1, ${admin.json({
          baseRevision: null,
          categories: [
            {
              content: [{ description: "", language: "es", title: "Todo" }],
              id: categoryId,
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
        })}, ${one.userId}
      )
    `;
    await admin`select private.ensure_payment_methods(${one.tenantId}::uuid, ${locationOne}::uuid)`;

    await createStaff(one, locationOne, "ana", "waiter", [sectorSalon]);
    await createStaff(one, locationOne, "marta", "manager", []);
    await createStaff(one, locationOne, "coco", "kitchen", []);
    await createStaff(one, locationOne, "beto", "bar", []);
    await createStaff(two, locationTwo, "otra", "kitchen", []);

    const config: ApiRuntimeConfig = {
      adminInviteRedirectUrl: "https://app.example.test/auth/callback",
      databaseUrl: databaseUrl ?? "",
      environment: "test",
      logLevel: "error",
      metricsPort: 9464,
      platformBaseDomain: "plataforma.test",
      platformTenantHostTemplate: "{slug}.{domain}",
      port: 3001,
      paymentSecretKey: null,
      staffPinPepper: pepper,
      supabaseSecretKey: supabaseSecretKey ?? "",
      supabaseUrl: supabaseUrl ?? ""
    };
    app = await NestFactory.create<NestFastifyApplication>(
      AppModule.register(config),
      new FastifyAdapter(),
      { logger: false }
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    for (const name of ["ana", "marta", "coco", "beto"]) {
      await login(one, name);
    }
    await login(two, "otra");
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await cleanup();
    await admin.end();
  });

  it("requires a session and a production role", async () => {
    const anonymous = await app!
      .getHttpAdapter()
      .getInstance()
      .inject({ method: "GET", url: "/v1/staff/production" });
    expect(anonymous.statusCode).toBe(401);
    expect((await board("ana")).status).toBe(403);
    expect((await board("marta")).status).toBe(403);
    expect((await board("coco")).status).toBe(200);
    expect((await board("beto")).status).toBe(200);
  });

  it("routes each item of a two-sector order to its own screen only", async () => {
    const { orderId } = await place();
    const kitchen = await board("coco");
    const bar = await board("beto");
    expect(kitchen.body.data.sector).toBe("kitchen");
    expect(bar.body.data.sector).toBe("bar");
    expect(
      ticketOf(kitchen.body, orderId)?.items.map(
        (item: { title: string }) => item.title
      )
    ).toEqual(["Milanesa"]);
    expect(
      ticketOf(bar.body, orderId)?.items.map(
        (item: { title: string }) => item.title
      )
    ).toEqual(["Cerveza"]);
    expect(ticketOf(kitchen.body, orderId)?.orderStatus).toBe("queued");
    const other = await board("otra");
    expect(other.body.data.tickets).toEqual([]);
  });

  it("never shows an order the waiter has not confirmed", async () => {
    const before = (await board("coco")).body.data.tickets.length;
    const response = await app!
      .getHttpAdapter()
      .getInstance()
      .inject({
        headers: { host: one.hostname },
        method: "POST",
        payload: {
          attribution: "table",
          commandId: next(),
          dinerName: "Valentín",
          items: [
            {
              lineId: next(),
              productId: milanesa,
              quantity: 1,
              variantId: null
            }
          ],
          paymentMethod: "cash",
          paymentPath: "in_person",
          seatLabel: null,
          token: (
            await admin<{ token: string }[]>`
              select qr.token from private.floor_table_qr_codes qr
              where qr.tenant_id = ${one.tenantId} and qr.table_id = ${tableMain}
                and qr.status = 'active'
            `
          )[0]?.token
        },
        url: "/v1/public/order-intents"
      });
    expect(response.statusCode).toBe(201);
    expect((await board("coco")).body.data.tickets).toHaveLength(before);
  });

  it("advances an item step by step and derives the order status", async () => {
    const { kitchenLine, orderId } = await place();
    const barLine = (
      await admin<{ line_id: string }[]>`
        select line_id from private.production_items
        where tenant_id = ${one.tenantId} and order_id = ${orderId}
          and sector_kind = 'bar'
      `
    )[0]!.line_id;

    expect((await advance("coco", orderId, kitchenLine, "ready")).status).toBe(
      409
    );
    const started = await advance("coco", orderId, kitchenLine, "preparing");
    expect(started.status).toBe(200);
    expect(started.body.data).toMatchObject({
      changed: true,
      orderStatus: "in_preparation",
      status: "preparing"
    });
    expect(
      (await advance("coco", orderId, kitchenLine, "ready")).body.data
        .orderStatus
    ).toBe("in_preparation");
    expect(ticketOf((await board("coco")).body, orderId)?.status).toBe("ready");

    await advance("beto", orderId, barLine, "preparing");
    const done = await advance("beto", orderId, barLine, "ready");
    expect(done.body.data.orderStatus).toBe("ready");
    expect(ticketOf((await board("beto")).body, orderId)?.orderStatus).toBe(
      "ready"
    );
  });

  it("protects sectors, tenants and the request shape", async () => {
    const { kitchenLine, orderId } = await place();
    expect(
      (await advance("beto", orderId, kitchenLine, "preparing")).status
    ).toBe(404);
    expect(
      (await advance("otra", orderId, kitchenLine, "preparing")).status
    ).toBe(404);
    expect(
      (await advance("ana", orderId, kitchenLine, "preparing")).status
    ).toBe(403);
    const forged = await staff(
      "coco",
      "POST",
      `/v1/staff/production/orders/${orderId}/items/${kitchenLine}/status`,
      {
        commandId: next(),
        sector: "bar",
        status: "preparing",
        tenantId: two.tenantId
      }
    );
    expect(forged.status).toBe(400);
    expect((await advance("coco", orderId, kitchenLine, "queued")).status).toBe(
      400
    );
    expect(
      (await advance("coco", orderId, kitchenLine, "delivered")).status
    ).toBe(400);
    const [row] = await admin<{ status: string }[]>`
      select status from private.production_items
      where tenant_id = ${one.tenantId} and order_id = ${orderId} and line_id = ${kitchenLine}
    `;
    expect(row?.status).toBe("queued");
  });

  it("does not duplicate tickets or events across retries and reconnections", async () => {
    const commandId = next();
    const first = await place(commandId);
    const replay = await place(commandId, [first.kitchenLine, first.barLine]);
    expect(replay.orderId).toBe(first.orderId);
    const [itemRow] = await admin<{ count: number }[]>`
      select count(*)::int as count from private.production_items
      where tenant_id = ${one.tenantId} and order_id = ${first.orderId}
    `;
    expect(itemRow?.count).toBe(2);

    const advanceCommand = next();
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        advance(
          "coco",
          first.orderId,
          first.kitchenLine,
          "preparing",
          advanceCommand
        )
      )
    );
    for (const result of results) expect(result.status).toBe(200);
    expect(
      new Set(results.map((result) => JSON.stringify(result.body))).size
    ).toBe(1);
    const [eventRow] = await admin<{ count: number }[]>`
      select count(*)::int as count from private.production_item_events
      where tenant_id = ${one.tenantId} and order_id = ${first.orderId}
    `;
    expect(eventRow?.count).toBe(1);

    const reuse = await advance(
      "coco",
      first.orderId,
      first.kitchenLine,
      "ready",
      advanceCommand
    );
    expect(reuse.status).toBe(409);
    expect(reuse.body.error.code).toBe("WAITER_COMMAND_REUSED");

    const reconnect = await advance(
      "coco",
      first.orderId,
      first.kitchenLine,
      "preparing"
    );
    expect(reconnect.status).toBe(200);
    expect(reconnect.body.data.changed).toBe(false);
  });
});
