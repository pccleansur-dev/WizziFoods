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
  hostname: "waiter-one.plataforma.test",
  slug: "waiter-it-1",
  tenantId: "fe000000-0000-4000-8000-000000000013",
  userId: "fe000000-0000-4000-8000-000000000011"
};
const two: Fixture = {
  hostname: "waiter-two.plataforma.test",
  slug: "waiter-it-2",
  tenantId: "fe000000-0000-4000-8000-000000000023",
  userId: "fe000000-0000-4000-8000-000000000021"
};

const level = "fe100000-0000-4000-8000-0000000000f1";
const sectorMain = "fe100000-0000-4000-8000-000000000001";
const sectorTerrace = "fe100000-0000-4000-8000-000000000002";
const tableMain = "fe200000-0000-4000-8000-000000000001";
const tableMain2 = "fe200000-0000-4000-8000-000000000002";
const tableTerrace = "fe200000-0000-4000-8000-000000000003";
const tableOther = "fe200000-0000-4000-8000-000000000009";
const productId = "fe300000-0000-4000-8000-000000000001";
const sectorProd = "fe300000-0000-4000-8000-000000000002";
const categoryId = "fe300000-0000-4000-8000-000000000003";

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

function uuid(seed: number): string {
  return `ff900000-0000-4000-8000-${String(seed).padStart(12, "0")}`;
}

describeWithLocalStack("waiter operations with local Supabase", () => {
  const admin = postgres(databaseAdminUrl ?? "", { prepare: false });
  let app: NestFastifyApplication | undefined;
  let locationOne = "";
  let locationTwo = "";
  const tokens = new Map<string, string>();
  const sessions = new Map<string, string>();
  let counter = 100;
  const next = () => uuid(counter++);

  async function cleanup() {
    for (const fixture of [one, two]) {
      const tenant = fixture.tenantId;
      // Triggers stay enabled for everyone else: other integration files assert
      // the append-only guards at the same time.
      await admin.begin(async (tx) => {
        await tx`set local session_replication_role = replica`;
        await tx`delete from private.cash_movements where tenant_id = ${tenant}`;
        await tx`delete from private.cash_shift_closures where tenant_id = ${tenant}`;
        await tx`delete from private.cash_shifts where tenant_id = ${tenant}`;
        await tx`delete from private.account_split_shares where split_id in (select id from private.account_splits where tenant_id = ${tenant})`;
        await tx`delete from private.account_splits where tenant_id = ${tenant}`;
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
      await admin`delete from private.order_intent_commands where tenant_id = ${fixture.tenantId}`;
      await admin`delete from private.product_operational_stock where tenant_id = ${fixture.tenantId}`;
      await admin`delete from private.audit_events where tenant_id = ${fixture.tenantId}`;
      await admin`delete from private.published_catalogs where tenant_id = ${fixture.tenantId}`;
      await admin`delete from private.location_publications where tenant_id = ${fixture.tenantId}`;
      await admin`delete from public.tenants where id = ${fixture.tenantId}`;
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

  async function diner(
    label: string,
    options: {
      method?: string;
      path?: string;
      quantity?: number;
    } = {}
  ) {
    const paymentMethod = options.method ?? "cash";
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
              productId,
              quantity: options.quantity ?? 1,
              variantId: null
            }
          ],
          paymentMethod,
          paymentPath: options.path ?? "in_person",
          seatLabel: null,
          token: tokens.get(label)
        },
        url: "/v1/public/order-intents"
      });
    expect(response.statusCode).toBe(201);
    return response.json().data as { callId: string | null; intentId: string };
  }

  const claim = (user: string, callId: string, commandId = next()) =>
    staff(user, "POST", `/v1/staff/calls/${callId}/claim`, { commandId });
  const decide = (
    user: string,
    intentId: string,
    decision: "confirm" | "reject",
    commandId = next(),
    reason: string | null = decision === "reject" ? "No lo quieren" : null
  ) =>
    staff(user, "POST", `/v1/staff/order-intents/${intentId}/decisions`, {
      commandId,
      decision,
      reason
    });

  beforeAll(async () => {
    await cleanup();
    for (const [index, fixture] of [one, two].entries()) {
      await admin`insert into auth.users (id) values (${fixture.userId})`;
      await admin`
        insert into public.tenants (id, slug, name, status)
        values (${fixture.tenantId}, ${fixture.slug}, 'Waiter IT', 'active')
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
      void index;
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
            { id: sectorMain, name: "Principal", position: 0 },
            { id: sectorTerrace, name: "Terraza", position: 1 }
          ],
          tables: [
            table(tableMain, "1", sectorMain, 40),
            table(tableMain2, "2", sectorMain, 200),
            table(tableTerrace, "3", sectorTerrace, 360)
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
          sectors: [{ id: sectorMain, name: "Principal", position: 0 }],
          tables: [table(tableOther, "1", sectorMain, 40)]
        })}
      )
    `;
    const rows = await admin<{ label: string; token: string }[]>`
      select label, token
      from private.list_floor_table_qr_codes(
        ${one.tenantId}::uuid, ${locationOne}::uuid, ${one.userId}::uuid
      )
    `;
    for (const row of rows) tokens.set(row.label, row.token);

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
              content: [{ description: "", language: "es", title: "Platos" }],
              id: categoryId,
              position: 0
            }
          ],
          products: [
            {
              categoryId,
              content: [
                { description: "Con papas", language: "es", title: "Milanesa" }
              ],
              id: productId,
              imageAssetId: null,
              position: 0,
              priceCents: 12_500,
              sectorId: sectorProd,
              variants: []
            }
          ],
          sectors: [
            { id: sectorProd, kind: "kitchen", name: "Cocina", position: 0 }
          ]
        })}, ${one.userId}
      )
    `;
    await admin`select private.ensure_payment_methods(${one.tenantId}::uuid, ${locationOne}::uuid)`;
    await admin`
      update private.payment_methods
      set enabled = true, public_config = '{"publicKey":"TEST_PUBLIC_KEY"}'
      where tenant_id = ${one.tenantId} and location_id = ${locationOne}
        and method_key = 'mercado_pago'
    `;
    await admin`
      insert into private.payment_method_secrets
        (tenant_id, location_id, method_key, ciphertext, key_version)
      values (${one.tenantId}, ${locationOne}, 'mercado_pago', decode(repeat('ab', 29), 'hex'), 1)
    `;

    await createStaff(one, locationOne, "ana", "waiter", [sectorMain]);
    await createStaff(one, locationOne, "bruno", "waiter", [sectorMain]);
    await createStaff(one, locationOne, "carla", "waiter", [sectorTerrace]);
    await createStaff(one, locationOne, "marta", "manager", []);
    await createStaff(one, locationOne, "coco", "kitchen", []);
    await createStaff(two, locationTwo, "otra", "waiter", [sectorMain]);

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
    for (const name of ["ana", "bruno", "carla", "marta", "coco"]) {
      await login(one, name);
    }
    await login(two, "otra");
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await cleanup();
    await admin.end();
  });

  it("requires a valid staff session and an operating role", async () => {
    const anonymous = await app!
      .getHttpAdapter()
      .getInstance()
      .inject({ method: "GET", url: "/v1/staff/salon" });
    expect(anonymous.statusCode).toBe(401);
    expect((await staff("coco", "GET", "/v1/staff/salon")).status).toBe(403);
  });

  it("shows each waiter only their sectors and never another tenant", async () => {
    await diner("1");
    await diner("3");
    const ana = await staff("ana", "GET", "/v1/staff/salon");
    expect(ana.status).toBe(200);
    expect(
      ana.body.data.units.map((unit: { label: string }) => unit.label)
    ).toEqual(["Mesa 1", "Mesa 2"]);
    expect(
      ana.body.data.calls.map((call: { tableLabel: string }) => call.tableLabel)
    ).toEqual(["1"]);
    const carla = await staff("carla", "GET", "/v1/staff/salon");
    expect(
      carla.body.data.calls.map(
        (call: { tableLabel: string }) => call.tableLabel
      )
    ).toEqual(["3"]);
    const marta = await staff("marta", "GET", "/v1/staff/salon");
    expect(marta.body.data.units).toHaveLength(3);
    const otra = await staff("otra", "GET", "/v1/staff/salon");
    expect(otra.body.data.calls).toEqual([]);
    expect(otra.body.data.intents).toEqual([]);
    expect(
      otra.body.data.units.map((unit: { label: string }) => unit.label)
    ).toEqual(["Mesa 1"]);
  });

  it("lets exactly one of two concurrent waiters claim a call", async () => {
    const { callId } = await diner("2");
    const results = await Promise.all([
      claim("ana", callId!),
      claim("bruno", callId!)
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    const loser = results.find((result) => result.status === 409)!;
    expect(loser.body.error.code).toBe("CALL_ALREADY_CLAIMED");
    const [row] = await admin<{ claimed_by: string; status: string }[]>`
      select claimed_by, status from private.waiter_calls where id = ${callId}
    `;
    expect(row?.status).toBe("acknowledged");
    const audits = await admin`
      select 1 from private.audit_events
      where action = 'waiter_call.claimed' and subject_id = ${callId}
    `;
    expect(audits).toHaveLength(1);
  });

  it("replays a claim command from the same waiter without a second effect", async () => {
    const { callId } = await diner("2");
    const commandId = next();
    const both = await Promise.all([
      claim("ana", callId!, commandId),
      claim("ana", callId!, commandId)
    ]);
    expect(both.map((result) => result.status)).toEqual([200, 200]);
    expect(both[0]!.body).toEqual(both[1]!.body);
  });

  it("does not let another tenant or sector touch a call", async () => {
    const { callId } = await diner("1");
    expect((await claim("otra", callId!)).status).toBe(404);
    expect((await claim("carla", callId!)).status).toBe(404);
    const [row] = await admin<{ status: string }[]>`
      select status from private.waiter_calls where id = ${callId}
    `;
    expect(row?.status).toBe("open");
  });

  it("rejects forged scope, identity and totals", async () => {
    const { intentId, callId } = await diner("1");
    const forged = [
      { commandId: next(), staffId: uuid(7) },
      { commandId: next(), tenantId: two.tenantId }
    ];
    for (const payload of forged) {
      expect(
        (await staff("ana", "POST", `/v1/staff/calls/${callId}/claim`, payload))
          .status
      ).toBe(400);
    }
    expect(
      (
        await staff(
          "ana",
          "POST",
          `/v1/staff/order-intents/${intentId}/decisions`,
          {
            commandId: next(),
            decision: "confirm",
            paymentMethod: "cash",
            reason: null,
            totalCents: 1
          }
        )
      ).status
    ).toBe(400);
    expect(
      (
        await staff("ana", "POST", "/v1/staff/orders", {
          attribution: "table",
          commandId: next(),
          dinerName: null,
          items: [{ lineId: next(), productId, quantity: 1, variantId: null }],
          seatLabel: null,
          tableId: tableMain,
          totalCents: 1
        })
      ).status
    ).toBe(400);
  });

  it("confirms an intent once, without payment or table state", async () => {
    const { intentId } = await diner("1", { quantity: 2 });
    const first = await decide("ana", intentId, "confirm");
    expect(first.status).toBe(200);
    expect(first.body.data.order).toMatchObject({
      accountDecision: "pending",
      payment: { state: "not_recorded" },
      status: "confirmed",
      totalCents: 25_000
    });
    expect((await decide("bruno", intentId, "confirm")).status).toBe(409);
    const [orders] = await admin<{ count: string }[]>`
      select count(*) from private.confirmed_orders where intent_id = ${intentId}
    `;
    expect(orders?.count).toBe("1");
    const states = await admin`
      select 1 from private.floor_table_service_states where tenant_id = ${one.tenantId}
    `;
    // T22: confirming opens the table session and occupies the table.
    expect(states).toHaveLength(1);
    const leaked = await admin<{ table_name: string }[]>`
      select table_name from information_schema.tables
      where table_schema = 'private'
        and table_name ~ '(ledger|payment_transaction|kds)'
    `;
    expect(leaked).toEqual([]);
  });

  it("applies exactly one decision when two waiters decide the same intent", async () => {
    const { intentId } = await diner("1");
    const results = await Promise.all([
      decide("ana", intentId, "confirm"),
      decide("bruno", intentId, "reject")
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    const [decision] = await admin<{ count: string }[]>`
      select count(*) from private.order_intent_decisions where intent_id = ${intentId}
    `;
    expect(decision?.count).toBe("1");
  });

  it("returns one order for concurrent retries of the same command", async () => {
    const { intentId } = await diner("1");
    const commandId = next();
    const both = await Promise.all([
      decide("ana", intentId, "confirm", commandId),
      decide("ana", intentId, "confirm", commandId)
    ]);
    expect(both.map((result) => result.status)).toEqual([200, 200]);
    expect(both[0]!.body).toEqual(both[1]!.body);
    const [orders] = await admin<{ count: string }[]>`
      select count(*) from private.confirmed_orders where intent_id = ${intentId}
    `;
    expect(orders?.count).toBe("1");
  });

  it("never lets staff confirm a pending Mercado Pago intent", async () => {
    const pending = await diner("1", {
      method: "mercado_pago",
      path: "online"
    });
    expect(pending.callId).toBeNull();
    const salon = await staff("marta", "GET", "/v1/staff/salon");
    expect(
      salon.body.data.intents.some(
        (intent: { id: string }) => intent.id === pending.intentId
      )
    ).toBe(false);
    const attempt = await decide("marta", pending.intentId, "confirm");
    expect(attempt.status).toBe(409);
    expect(attempt.body.error.code).toBe("INTENT_NOT_CONFIRMABLE");
    const [row] = await admin<{ status: string }[]>`
      select status from private.order_intents where id = ${pending.intentId}
    `;
    expect(row?.status).toBe("payment_pending");
  });

  it("decrements stock atomically when two waiters confirm competing intents", async () => {
    const first = await diner("1");
    const second = await diner("2");
    await admin`
      insert into private.product_operational_stock
        (tenant_id, location_id, product_id, available_quantity)
      values (${one.tenantId}, ${locationOne}, ${productId}, 1)
    `;
    const results = await Promise.all([
      decide("ana", first.intentId, "confirm"),
      decide("bruno", second.intentId, "confirm")
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    expect(
      results.find((result) => result.status === 409)!.body.error.code
    ).toBe("STOCK_INSUFFICIENT");
    const [stock] = await admin<{ available_quantity: number }[]>`
      select available_quantity from private.product_operational_stock
      where tenant_id = ${one.tenantId}
    `;
    expect(stock?.available_quantity).toBe(0);
    await admin`delete from private.product_operational_stock where tenant_id = ${one.tenantId}`;
  });

  it("loads a manual order priced by the menu and attributed to a person", async () => {
    const menu = await staff("ana", "GET", "/v1/staff/menu");
    expect(menu.status).toBe(200);
    expect(menu.body.data.catalog.products).toHaveLength(1);
    const commandId = next();
    const payload = {
      attribution: "individual",
      commandId,
      dinerName: "Marcos",
      items: [{ lineId: next(), productId, quantity: 3, variantId: null }],
      seatLabel: "Silla 2",
      tableId: tableMain
    };
    const created = await staff("ana", "POST", "/v1/staff/orders", payload);
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      accountDecision: "pending",
      payment: { state: "not_recorded" },
      source: "manual",
      totalCents: 37_500
    });
    const replay = await staff("ana", "POST", "/v1/staff/orders", payload);
    expect(replay.body).toEqual(created.body);
    expect(
      (
        await staff("ana", "POST", "/v1/staff/orders", {
          ...payload,
          commandId: next(),
          tableId: tableTerrace
        })
      ).status
    ).toBe(404);
    expect(
      (
        await staff("otra", "POST", "/v1/staff/orders", {
          ...payload,
          commandId: next()
        })
      ).status
    ).toBe(404);
  });

  it("audits decisions without secrets and keeps orders append-only", async () => {
    const audits = await admin<{ action: string; reason: string }[]>`
      select action, reason from private.audit_events
      where tenant_id = ${one.tenantId}
        and action in ('order.confirmed', 'order.manual_confirmed', 'waiter_call.claimed')
    `;
    expect(audits.length).toBeGreaterThan(0);
    expect(JSON.stringify(audits)).not.toMatch(/pin|token|135790/iu);
    await expect(
      admin`update private.confirmed_orders set total_cents = 1 where tenant_id = ${one.tenantId}`
    ).rejects.toMatchObject({ code: "PT209" });
  });

  it("stops serving a revoked or deactivated staff session", async () => {
    await admin`
      update public.staff_members set is_active = false
      where tenant_id = ${one.tenantId} and username = 'bruno'
    `;
    expect((await staff("bruno", "GET", "/v1/staff/salon")).status).toBe(401);
  });
});
