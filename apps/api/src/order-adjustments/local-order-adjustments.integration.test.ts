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

type Fixture = { slug: string; tenantId: string; userId: string };

const one: Fixture = {
  slug: "adjustment-it-1",
  tenantId: "1c000000-0000-4000-8000-000000000013",
  userId: "1c000000-0000-4000-8000-000000000011"
};
const two: Fixture = {
  slug: "adjustment-it-2",
  tenantId: "1c000000-0000-4000-8000-000000000023",
  userId: "1c000000-0000-4000-8000-000000000021"
};

const level = "1c100000-0000-4000-8000-0000000000f1";
const sectorSalon = "1c100000-0000-4000-8000-000000000001";
const sectorTerrace = "1c100000-0000-4000-8000-000000000002";
const tableMain = "1c200000-0000-4000-8000-000000000001";
const tableTerrace = "1c200000-0000-4000-8000-000000000002";
const tableOther = "1c200000-0000-4000-8000-000000000009";
const categoryId = "1c300000-0000-4000-8000-000000000003";
const kitchenSector = "1c300000-0000-4000-8000-000000000002";
const barSector = "1c300000-0000-4000-8000-000000000004";
const milanesa = "1c300000-0000-4000-8000-000000000001";
const cerveza = "1c300000-0000-4000-8000-000000000005";
const vino = "1c300000-0000-4000-8000-000000000006";
const pollo = "1c300000-0000-4000-8000-000000000007";

function uuid(seed: number): string {
  return `ff700000-0000-4000-8000-${String(seed).padStart(12, "0")}`;
}

function table(id: string, label: string, sectorId: string) {
  return {
    floorId: level,
    height: 100,
    id,
    label,
    rotation: 0,
    seatCount: 4,
    seatLayout: "perimeter",
    sectorId,
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
  position: number,
  priceCents: number
) {
  return {
    categoryId,
    content: [{ description: "", language: "es", title }],
    id,
    imageAssetId: null,
    position,
    priceCents,
    sectorId,
    variants: []
  };
}

describeWithLocalStack("order adjustments with local Supabase", () => {
  const admin = postgres(databaseAdminUrl ?? "", { prepare: false });
  let app: NestFastifyApplication | undefined;
  let locationOne = "";
  let locationTwo = "";
  const sessions = new Map<string, string>();
  let counter = 100;
  const next = () => uuid(counter++);

  // Triggers stay enabled for everyone else: other integration files assert the
  // append-only guards at the same time, so only this transaction skips them.
  async function cleanup() {
    for (const fixture of [one, two]) {
      const tenant = fixture.tenantId;
      await admin.begin(async (tx) => {
        await tx`set local session_replication_role = replica`;
        await tx`delete from private.account_entries where tenant_id = ${tenant}`;
        await tx`delete from private.account_decisions where tenant_id = ${tenant}`;
        await tx`delete from private.table_sessions where tenant_id = ${tenant}`;
        await tx`delete from private.order_adjustments where tenant_id = ${tenant}`;
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

  /** A manual order of one kitchen item and one bar item on a table. */
  async function place(
    user: string,
    tableId: string,
    kitchenProduct = milanesa,
    barProduct = cerveza
  ): Promise<Placed> {
    const kitchenLine = next();
    const barLine = next();
    const response = await staff(user, "POST", "/v1/staff/orders", {
      attribution: "table",
      commandId: next(),
      dinerName: null,
      items: [
        {
          lineId: kitchenLine,
          productId: kitchenProduct,
          quantity: 1,
          variantId: null
        },
        { lineId: barLine, productId: barProduct, quantity: 1, variantId: null }
      ],
      seatLabel: null,
      tableId
    });
    expect(response.status).toBe(201);
    return { barLine, kitchenLine, orderId: response.body.data.orderId };
  }

  const move = (
    user: string,
    order: string,
    line: string,
    status: "preparing" | "ready"
  ) =>
    staff(
      user,
      "POST",
      `/v1/staff/production/orders/${order}/items/${line}/status`,
      {
        commandId: next(),
        status
      }
    );
  const prepare = async (user: string, order: string, line: string) => {
    await move(user, order, line, "preparing");
    return move(user, order, line, "ready");
  };
  const deliver = (
    user: string,
    order: string,
    line: string,
    commandId = next()
  ) =>
    staff(user, "POST", `/v1/staff/orders/${order}/items/${line}/delivery`, {
      commandId
    });
  const shortage = (
    user: string,
    order: string,
    line: string,
    reason = "Se terminó"
  ) =>
    staff(
      user,
      "POST",
      `/v1/staff/production/orders/${order}/items/${line}/exception`,
      {
        commandId: next(),
        reason
      }
    );
  const propose = (
    user: string,
    order: string,
    line: string,
    productId: string
  ) =>
    staff(user, "POST", `/v1/staff/orders/${order}/items/${line}/replacement`, {
      commandId: next(),
      productId,
      variantId: null
    });
  const decide = (
    user: string,
    adjustment: string,
    decision: "accept" | "reject",
    commandId = next()
  ) =>
    staff(user, "POST", `/v1/staff/order-adjustments/${adjustment}/decision`, {
      commandId,
      decision,
      reason: decision === "reject" ? "No quiere" : null
    });
  const cancel = (
    user: string,
    order: string,
    line: string,
    reason = "Sin reemplazo"
  ) =>
    staff(
      user,
      "POST",
      `/v1/staff/orders/${order}/items/${line}/cancellation`,
      {
        commandId: next(),
        reason
      }
    );
  const inProgress = (user: string) =>
    staff(user, "GET", "/v1/staff/orders/in-progress");
  const orderOf = (
    body: { data: { orders: { orderId: string }[] } },
    orderId: string
  ) =>
    body.data.orders.find((order) => order.orderId === orderId) as
      | {
          adjustmentCents: number;
          items: { adjustment: unknown; status: string; title: string }[];
          status: string;
        }
      | undefined;

  beforeAll(async () => {
    await cleanup();
    for (const fixture of [one, two]) {
      await admin`insert into auth.users (id) values (${fixture.userId})`;
      await admin`
        insert into public.tenants (id, slug, name, status)
        values (${fixture.tenantId}, ${fixture.slug}, 'Adjustment IT', 'active')
      `;
      await admin`
        insert into public.tenant_memberships (tenant_id, user_id, role)
        values (${fixture.tenantId}, ${fixture.userId}, 'admin')
      `;
      await admin`
        insert into public.tenant_domains (
          tenant_id, hostname, kind, status, is_primary
        ) values (
          ${fixture.tenantId}, ${`${fixture.slug}.plataforma.test`},
          'platform_subdomain', 'active', true
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

    await admin`
      select private.save_floor_plan(
        ${one.tenantId}::uuid, ${locationOne}::uuid, ${one.userId}::uuid,
        ${uuid(1)}::uuid, 0, ${admin.json({
          floors: [{ id: level, name: "Salón", position: 0, shortName: null }],
          groups: [],
          sectors: [
            { id: sectorSalon, name: "Salón", position: 0 },
            { id: sectorTerrace, name: "Terraza", position: 1 }
          ],
          tables: [
            table(tableMain, "1", sectorSalon),
            table(tableTerrace, "2", sectorTerrace)
          ]
        })}
      )
    `;
    await admin`
      select private.save_floor_plan(
        ${two.tenantId}::uuid, ${locationTwo}::uuid, ${two.userId}::uuid,
        ${uuid(2)}::uuid, 0, ${admin.json({
          floors: [{ id: level, name: "Salón", position: 0, shortName: null }],
          groups: [],
          sectors: [{ id: sectorSalon, name: "Salón", position: 0 }],
          tables: [table(tableOther, "1", sectorSalon)]
        })}
      )
    `;
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
            product(milanesa, "Milanesa", kitchenSector, 0, 12_500),
            product(cerveza, "Cerveza", barSector, 1, 4_000),
            product(vino, "Vino", barSector, 2, 6_900),
            product(pollo, "Pollo", kitchenSector, 3, 9_000)
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
    await createStaff(one, locationOne, "bruno", "waiter", [sectorTerrace]);
    await createStaff(one, locationOne, "marta", "manager", []);
    await createStaff(one, locationOne, "coco", "kitchen", []);
    await createStaff(one, locationOne, "beto", "bar", []);
    await createStaff(two, locationTwo, "otro", "waiter", [sectorSalon]);
    await createStaff(two, locationTwo, "otra", "manager", []);

    const config: ApiRuntimeConfig = {
      adminInviteRedirectUrl: "https://app.example.test/auth/callback",
      databaseUrl: databaseUrl ?? "",
      environment: "test",
      logLevel: "error",
      metricsPort: 9464,
      platformBaseDomain: "plataforma.test",
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
    for (const name of ["ana", "bruno", "marta", "coco", "beto"]) {
      await login(one, name);
    }
    for (const name of ["otro", "otra"]) await login(two, name);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await cleanup();
    await admin.end();
  });

  it("limits each operation to the roles that own it", async () => {
    const { barLine, kitchenLine, orderId } = await place("ana", tableMain);
    expect((await inProgress("coco")).status).toBe(403);
    expect((await deliver("coco", orderId, kitchenLine)).status).toBe(403);
    expect((await shortage("ana", orderId, kitchenLine)).status).toBe(403);
    expect((await shortage("marta", orderId, kitchenLine)).status).toBe(403);
    expect((await cancel("ana", orderId, kitchenLine)).status).toBe(403);
    expect((await cancel("coco", orderId, kitchenLine)).status).toBe(403);
    expect((await propose("coco", orderId, barLine, vino)).status).toBe(403);
    const forged = await staff(
      "ana",
      "POST",
      `/v1/staff/orders/${orderId}/items/${kitchenLine}/delivery`,
      { commandId: next(), tenantId: two.tenantId }
    );
    expect(forged.status).toBe(400);
    const anon = await app!
      .getHttpAdapter()
      .getInstance()
      .inject({ method: "GET", url: "/v1/staff/orders/in-progress" });
    expect(anon.statusCode).toBe(401);
  });

  it("delivers only what is ready, only on the waiter's tables", async () => {
    const { kitchenLine, orderId } = await place("ana", tableMain);
    const early = await deliver("ana", orderId, kitchenLine);
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe("ITEM_NOT_READY");
    await prepare("coco", orderId, kitchenLine);
    expect((await deliver("bruno", orderId, kitchenLine)).status).toBe(404);
    expect((await deliver("otro", orderId, kitchenLine)).status).toBe(404);
    const delivered = await deliver("ana", orderId, kitchenLine);
    expect(delivered.status).toBe(200);
    expect(delivered.body.data).toMatchObject({
      changed: true,
      orderStatus: "in_preparation",
      status: "delivered"
    });
    const view = await inProgress("ana");
    expect(
      orderOf(view.body, orderId)?.items.map((item) => item.status)
    ).toEqual(["delivered", "queued"]);
    const other = await inProgress("bruno");
    expect(orderOf(other.body, orderId)).toBeUndefined();
    const foreign = await inProgress("otro");
    expect(foreign.body.data.orders).toEqual([]);
  });

  it("goes from a shortage to an accepted replacement with a linked difference", async () => {
    const { barLine, orderId } = await place("ana", tableMain);
    expect((await shortage("coco", orderId, barLine)).status).toBe(404);
    const reported = await shortage(
      "beto",
      orderId,
      barLine,
      "Se terminó la cerveza"
    );
    expect(reported.status).toBe(200);
    expect(reported.body.data.orderStatus).toBe("exception");
    expect(orderOf((await inProgress("ana")).body, orderId)?.status).toBe(
      "exception"
    );

    const proposal = await propose("ana", orderId, barLine, vino);
    expect(proposal.status).toBe(200);
    expect(proposal.body.data).toMatchObject({
      differenceCents: 2_900,
      originalTotalCents: 4_000,
      replacementTotalCents: 6_900,
      status: "proposed"
    });
    const adjustmentId = proposal.body.data.adjustmentId as string;
    expect((await decide("coco", adjustmentId, "accept")).status).toBe(403);
    expect((await decide("otro", adjustmentId, "accept")).status).toBe(404);
    const accepted = await decide("ana", adjustmentId, "accept");
    expect(accepted.status).toBe(200);
    expect(accepted.body.data.status).toBe("accepted");

    const order = orderOf((await inProgress("ana")).body, orderId);
    expect(order?.adjustmentCents).toBe(2_900);
    expect(order?.items.map((item) => `${item.title}:${item.status}`)).toEqual([
      "Milanesa:queued",
      "Cerveza:replaced",
      "Vino:queued"
    ]);
    const barBoard = await staff("beto", "GET", "/v1/staff/production");
    const ticket = barBoard.body.data.tickets.find(
      (entry: { orderId: string }) => entry.orderId === orderId
    );
    expect(
      ticket.items.map(
        (item: { title: string; status: string }) =>
          `${item.title}:${item.status}`
      )
    ).toEqual(["Cerveza:replaced", "Vino:queued"]);
    const [original] = await admin<{ total_cents: number }[]>`
      select total_cents from private.confirmed_orders where id = ${orderId}
    `;
    expect(original?.total_cents).toBe(16_500);
  });

  it("goes from a shortage to a cancellation only a manager can make", async () => {
    const { kitchenLine, orderId } = await place("ana", tableMain);
    await move("coco", orderId, kitchenLine, "preparing");
    await shortage("coco", orderId, kitchenLine, "Se quemó");
    const rejection = await propose("ana", orderId, kitchenLine, pollo);
    await decide("ana", rejection.body.data.adjustmentId, "reject");
    expect(
      orderOf((await inProgress("ana")).body, orderId)?.items[0]?.status
    ).toBe("exception");
    expect((await cancel("ana", orderId, kitchenLine)).status).toBe(403);
    const blank = await staff(
      "marta",
      "POST",
      `/v1/staff/orders/${orderId}/items/${kitchenLine}/cancellation`,
      { commandId: next(), reason: "  " }
    );
    expect(blank.status).toBe(400);
    const cancelled = await cancel("marta", orderId, kitchenLine);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data).toMatchObject({
      differenceCents: -12_500,
      status: "cancelled"
    });
    expect((await cancel("marta", orderId, kitchenLine)).status).toBe(409);
    const [kept] = await admin<{ count: number }[]>`
      select count(*)::int as count from private.confirmed_order_items
      where order_id = ${orderId}
    `;
    expect(kept?.count).toBe(2);
  });

  it("never duplicates a delivery or a decision under concurrency", async () => {
    const delivery = await place("ana", tableMain);
    await prepare("coco", delivery.orderId, delivery.kitchenLine);
    const commandId = next();
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        deliver("ana", delivery.orderId, delivery.kitchenLine, commandId)
      )
    );
    for (const result of results) expect(result.status).toBe(200);
    expect(
      new Set(results.map((result) => JSON.stringify(result.body))).size
    ).toBe(1);
    const [events] = await admin<{ count: number }[]>`
      select count(*)::int as count from private.production_item_events
      where order_id = ${delivery.orderId} and to_status = 'delivered'
    `;
    expect(events?.count).toBe(1);

    const replacement = await place("ana", tableMain);
    await shortage("beto", replacement.orderId, replacement.barLine);
    const proposal = await propose(
      "ana",
      replacement.orderId,
      replacement.barLine,
      vino
    );
    const adjustmentId = proposal.body.data.adjustmentId as string;
    const decisions = await Promise.all([
      decide("ana", adjustmentId, "accept"),
      decide("marta", adjustmentId, "reject"),
      decide("ana", adjustmentId, "accept")
    ]);
    const statuses = decisions.map((result) => result.status).sort();
    expect(
      statuses.filter((status) => status === 200).length
    ).toBeGreaterThanOrEqual(1);
    expect(
      statuses.filter((status) => status === 200).length
    ).toBeLessThanOrEqual(2);
    const [resolved] = await admin<{ count: number }[]>`
      select count(*)::int as count from private.order_adjustments
      where id = ${adjustmentId} and status in ('accepted', 'rejected')
    `;
    expect(resolved?.count).toBe(1);
    const [lines] = await admin<{ count: number }[]>`
      select count(*)::int as count from private.confirmed_order_items
      where order_id = ${replacement.orderId}
    `;
    expect(lines?.count).toBeLessThanOrEqual(3);
  });

  it("keeps the history immutable and audited", async () => {
    const { barLine, orderId } = await place("ana", tableMain);
    await shortage("beto", orderId, barLine);
    await expect(
      admin`update private.production_items set status = 'queued' where order_id = ${orderId} and line_id = ${barLine}`
    ).rejects.toMatchObject({ code: "PT209" });
    await expect(
      admin`delete from private.production_item_events where order_id = ${orderId}`
    ).rejects.toMatchObject({ code: "PT209" });
    const audits = await admin<{ reason: string }[]>`
      select reason from private.audit_events
      where tenant_id = ${one.tenantId} and action = 'production.exception_reported'
    `;
    expect(audits.length).toBeGreaterThan(0);
    expect(JSON.stringify(audits)).not.toMatch(/pin|token|135790/iu);
  });
});
