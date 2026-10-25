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
  slug: "cash-it-1",
  tenantId: "2c000000-0000-4000-8000-000000000013",
  userId: "2c000000-0000-4000-8000-000000000011"
};
const two: Fixture = {
  slug: "cash-it-2",
  tenantId: "2c000000-0000-4000-8000-000000000023",
  userId: "2c000000-0000-4000-8000-000000000021"
};

const level = "2c100000-0000-4000-8000-0000000000f1";
const sectorSalon = "2c100000-0000-4000-8000-000000000001";
const categoryId = "2c300000-0000-4000-8000-000000000003";
const kitchenSector = "2c300000-0000-4000-8000-000000000002";
const barSector = "2c300000-0000-4000-8000-000000000004";
const milanesa = "2c300000-0000-4000-8000-000000000001";
const cerveza = "2c300000-0000-4000-8000-000000000005";
const prices: Record<string, number> = { [cerveza]: 4_000, [milanesa]: 12_500 };
const tableCount = 20;
const tableId = (n: number) =>
  `2c200000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const methods = [
  "cash",
  "credit_card",
  "debit_card",
  "other_in_person"
] as const;

function uuid(seed: number): string {
  return `ff500000-0000-4000-8000-${String(seed).padStart(12, "0")}`;
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
    priceCents: prices[id],
    sectorId,
    variants: []
  };
}

/** Small seeded generator so a failing sequence can be reproduced. */
function generator(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describeWithLocalStack("cash register with local Supabase", () => {
  const admin = postgres(databaseAdminUrl ?? "", { prepare: false });
  let app: NestFastifyApplication | undefined;
  let locationOne = "";
  let locationTwo = "";
  const sessions = new Map<string, string>();
  const staffIds = new Map<string, string>();
  let counter = 1_000;
  const next = () => uuid(counter++);

  // Triggers stay enabled for everyone else: other integration files assert the
  // append-only guards at the same time, so only this transaction skips them.
  async function cleanup() {
    for (const fixture of [one, two]) {
      const tenant = fixture.tenantId;
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
      await admin`delete from private.order_intent_commands where tenant_id = ${tenant}`;
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
    const [row] = await admin<{ result: { id: string } }[]>`
      select private.create_staff_member(
        ${fixture.tenantId}::uuid, ${locationId}::uuid, ${fixture.userId}::uuid,
        ${username}, ${username}, ${role}, ${hash}, ${sectors}::uuid[]
      ) as result
    `;
    staffIds.set(`${fixture.slug}:${username}`, row!.result.id);
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

  const managerId = () => staffIds.get(`${one.slug}:marta`)!;

  async function place(table: number, products: string[]) {
    const lines = products.map((productId) => ({
      lineId: next(),
      productId,
      quantity: 1,
      variantId: null
    }));
    const [row] = await admin<{ result: { orderId: string } }[]>`
      select private.create_manual_order(
        ${one.tenantId}::uuid, ${locationOne}::uuid, ${managerId()}::uuid,
        ${next()}::uuid, ${tableId(table)}::uuid, 'table', null, null,
        ${admin.json(lines)}
      ) as result
    `;
    return { lines, orderId: row!.result.orderId };
  }

  async function sessionOf(table: number): Promise<string> {
    const [row] = await admin<{ id: string }[]>`
      select id from private.table_sessions
      where tenant_id = ${one.tenantId} and scope_key = ${tableId(table)}
        and status = 'open'
    `;
    return row!.id;
  }

  async function pendingOf(sessionId: string): Promise<number> {
    const [row] = await admin<{ pending: number }[]>`
      select (private.account_summary(
        ${one.tenantId}::uuid, ${locationOne}::uuid, ${sessionId}::uuid
      ) ->> 'pendingCents')::integer as pending
    `;
    return row!.pending;
  }

  const open = (user: string, openingCashCents: number, commandId = next()) =>
    staff(user, "POST", "/v1/staff/cash-register/open", {
      commandId,
      openingCashCents
    });
  const closeShift = (
    user: string,
    countedCashCents: number,
    reason: string | null = null,
    commandId = next()
  ) =>
    staff(user, "POST", "/v1/staff/cash-register/close", {
      commandId,
      countedCashCents,
      reason
    });
  const pay = (
    user: string,
    sessionId: string,
    body: Record<string, unknown>,
    commandId = next()
  ) =>
    staff(user, "POST", `/v1/staff/accounts/${sessionId}/payments`, {
      amountCents: null,
      commandId,
      method: "cash",
      tipCents: 0,
      ...body
    });
  const refund = (
    user: string,
    sessionId: string,
    body: Record<string, unknown>,
    commandId = next()
  ) =>
    staff(user, "POST", `/v1/staff/accounts/${sessionId}/refunds`, {
      commandId,
      itemLineId: null,
      reason: "Devolución",
      ...body
    });

  async function ensureClosed() {
    const view = await staff("marta", "GET", "/v1/staff/cash-register");
    if (view.body.data.register.open) {
      const attempt = await closeShift("marta", 0, "Cierre de prueba");
      expect(attempt.status).toBe(200);
    }
  }

  beforeAll(async () => {
    await cleanup();
    for (const fixture of [one, two]) {
      await admin`insert into auth.users (id) values (${fixture.userId})`;
      await admin`
        insert into public.tenants (id, slug, name, status)
        values (${fixture.tenantId}, ${fixture.slug}, 'Cash IT', 'active')
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

    const tables = Array.from({ length: tableCount }, (_, index) => ({
      floorId: level,
      height: 100,
      id: tableId(index + 1),
      label: String(index + 1),
      rotation: 0,
      seatCount: 4,
      seatLayout: "perimeter",
      sectorId: sectorSalon,
      shape: "square",
      width: 100,
      x: 40 + index * 120,
      y: 60
    }));
    await admin`
      select private.save_floor_plan(
        ${one.tenantId}::uuid, ${locationOne}::uuid, ${one.userId}::uuid,
        ${uuid(1)}::uuid, 0, ${admin.json({
          floors: [{ id: level, name: "Salón", position: 0, shortName: null }],
          groups: [],
          sectors: [{ id: sectorSalon, name: "Salón", position: 0 }],
          tables
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
          tables: [{ ...tables[0], id: "2c200000-0000-4000-8000-0000000000ff" }]
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
    for (const name of ["ana", "marta", "coco"]) await login(one, name);
    await login(two, "otra");
  }, 90_000);

  afterAll(async () => {
    await app?.close();
    await cleanup();
    await admin.end();
  });

  it("limits the register to the manager and refuses to collect while it is closed", async () => {
    await place(1, [milanesa]);
    const sessionId = await sessionOf(1);
    expect((await staff("coco", "GET", "/v1/staff/cash-register")).status).toBe(
      403
    );
    const closed = await pay("ana", sessionId, {});
    expect(closed.status).toBe(409);
    expect(closed.body.error.code).toBe("CASH_REGISTER_CLOSED");
    expect((await open("ana", 1000)).status).toBe(403);
    expect((await open("coco", 1000)).status).toBe(403);
    const forged = await staff(
      "marta",
      "POST",
      "/v1/staff/cash-register/open",
      {
        commandId: next(),
        openingCashCents: 100,
        tenantId: two.tenantId
      }
    );
    expect(forged.status).toBe(400);
    const card = await refund("marta", sessionId, {
      amountCents: 100,
      cardNumber: "4111111111111111",
      paymentId: next()
    });
    expect(card.status).toBe(400);
    const peek = await staff("marta", "POST", "/v1/staff/cash-register/close", {
      commandId: next(),
      countedCashCents: 100,
      expectedCashCents: 100,
      reason: null
    });
    expect(peek.status).toBe(400);
    const anonymous = await app!
      .getHttpAdapter()
      .getInstance()
      .inject({ method: "GET", url: "/v1/staff/cash-register" });
    expect(anonymous.statusCode).toBe(401);
    expect((await staff("ana", "GET", "/v1/staff/cash-register")).status).toBe(
      200
    );
    const foreign = await staff("otra", "GET", "/v1/staff/cash-register");
    expect(foreign.body.data.register.open).toBe(false);
  });

  it("runs a shift: mixed collections, a refund and a blind close with a justified difference", async () => {
    const opened = await open("marta", 5_000);
    expect(opened.status).toBe(200);
    const view = await staff("ana", "GET", "/v1/staff/cash-register");
    expect(view.body.data).toMatchObject({
      canManage: false,
      register: { open: true, openedByName: "marta", paymentCount: 0 }
    });
    expect(view.body.data.register).not.toHaveProperty("expectedCashCents");

    const { lines } = await place(2, [milanesa, cerveza]);
    const sessionId = await sessionOf(2);
    const cash = await pay("ana", sessionId, {
      amountCents: 10_000,
      tipCents: 500
    });
    expect(cash.status).toBe(200);
    const card = await pay("ana", sessionId, {
      amountCents: 4_000,
      method: "debit_card"
    });
    expect(card.status).toBe(200);
    const rest = await pay("ana", sessionId, { method: "cash" });
    expect(rest.body.data.pendingCents).toBe(0);

    // Cancel the beer after paying: the diner has a credit, only the manager refunds.
    await admin`
      select private.cancel_order_item(
        ${one.tenantId}::uuid, ${locationOne}::uuid, ${managerId()}::uuid,
        ${next()}::uuid,
        (select order_id from private.confirmed_order_items where line_id = ${lines[1]!.lineId}::uuid limit 1),
        ${lines[1]!.lineId}::uuid, 'Se terminó'
      )
    `;
    expect(await pendingOf(sessionId)).toBe(-4_000);
    const paymentId = card.body.data.paymentId as string;
    expect(
      (await refund("ana", sessionId, { amountCents: 100, paymentId })).status
    ).toBe(403);
    const tooMuch = await refund("marta", sessionId, {
      amountCents: 4_001,
      paymentId
    });
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.body.error.code).toBe("REFUND_EXCEEDS_LIMIT");
    const returned = await refund("marta", sessionId, {
      amountCents: 4_000,
      itemLineId: lines[1]!.lineId,
      paymentId
    });
    expect(returned.status).toBe(200);
    expect(returned.body.data).toMatchObject({
      pendingCents: 0,
      refundCents: 4_000
    });

    const out = await staff(
      "marta",
      "POST",
      "/v1/staff/cash-register/movements",
      {
        amountCents: 2_000,
        commandId: next(),
        kind: "cash_out",
        reason: "Retiro a caja fuerte"
      }
    );
    expect(out.status).toBe(200);

    // Expected cash: 5000 float + 10500 + 3500 cash payments - 2000 taken out = 16000.
    const wrong = await closeShift("marta", 15_300);
    expect(wrong.status).toBe(200);
    expect(wrong.body.data).toEqual({
      closed: false,
      differenceCents: -700,
      shiftId: opened.body.data.shiftId
    });
    const closed = await closeShift("marta", 15_300, "Faltó cambio");
    expect(closed.body.data).toMatchObject({
      closed: true,
      differenceCents: -700,
      expectedCashCents: 16_000,
      reason: "Faltó cambio"
    });
    expect(closed.body.data.breakdown.methods.debit_card).toEqual({
      receivedCents: 4_000,
      refundedCents: 4_000
    });
    const afterClose = await pay("ana", await sessionOf(2), { amountCents: 1 });
    expect(afterClose.status).toBe(409);
    const history = await staff("marta", "GET", "/v1/staff/cash-register");
    expect(history.body.data.closures[0]).toMatchObject({
      differenceCents: -700,
      reason: "Faltó cambio"
    });
    expect(history.body.data.register.open).toBe(false);
  });

  it("opens one register when several are opened at once and returns the same result on retries", async () => {
    await ensureClosed();
    const commandId = next();
    const results = await Promise.all([
      open("marta", 100, commandId),
      open("marta", 100, commandId),
      open("marta", 200),
      open("marta", 300)
    ]);
    const ok = results.filter((result) => result.status === 200);
    const conflicts = results.filter((result) => result.status === 409);
    expect(ok.length).toBeGreaterThanOrEqual(1);
    expect(ok.length + conflicts.length).toBe(4);
    expect(new Set(ok.map((result) => result.body.data.shiftId)).size).toBe(1);
    const [open1] = await admin<{ count: number }[]>`
      select count(*)::int as count from private.cash_shifts
      where tenant_id = ${one.tenantId} and status = 'open'
    `;
    expect(open1?.count).toBe(1);
  });

  it("refunds a credit only once when the same refund races", async () => {
    await ensureClosed();
    await open("marta", 0);
    const placed = await place(3, [cerveza]);
    const sessionId = await sessionOf(3);
    const paid = await pay("ana", sessionId, {});
    await admin`
      select private.cancel_order_item(
        ${one.tenantId}::uuid, ${locationOne}::uuid, ${managerId()}::uuid,
        ${next()}::uuid, ${placed.orderId}::uuid, ${placed.lines[0]!.lineId}::uuid, 'Sin stock'
      )
    `;
    expect(await pendingOf(sessionId)).toBe(-4_000);
    const paymentId = paid.body.data.paymentId as string;
    const same = next();
    const results = await Promise.all([
      refund("marta", sessionId, { amountCents: 4_000, paymentId }, same),
      refund("marta", sessionId, { amountCents: 4_000, paymentId }, same),
      refund("marta", sessionId, { amountCents: 4_000, paymentId })
    ]);
    expect(
      results.filter((result) => result.status === 200).length
    ).toBeGreaterThanOrEqual(1);
    const [refunds] = await admin<{ count: number }[]>`
      select count(*)::int as count from private.account_entries
      where session_id = ${sessionId} and kind = 'refund'
    `;
    expect(refunds?.count).toBe(1);
    expect(await pendingOf(sessionId)).toBe(0);
  });

  it("derives the expected cash exactly over random sequences against an independent model", async () => {
    // Fixed seeds keep it reproducible: a failure names the seed and step.
    for (let sequence = 0; sequence < 8; sequence += 1) {
      await ensureClosed();
      const seed = 4_000 + sequence;
      const random = generator(seed);
      const pick = <T>(items: readonly T[]) =>
        items[Math.floor(random() * items.length)]!;
      const opening = Math.floor(random() * 20_000);
      expect((await open("marta", opening)).status).toBe(200);
      let cash = opening;
      const table = 4 + sequence;
      const payments: {
        id: string;
        method: (typeof methods)[number];
        remaining: number;
      }[] = [];
      let lineToCancel: { line: string; order: string } | null = null;

      for (let step = 0; step < 12; step += 1) {
        const label = `seed ${seed} step ${step}`;
        const action = random();
        const existing = await admin<{ id: string }[]>`
          select id from private.table_sessions
          where tenant_id = ${one.tenantId} and scope_key = ${tableId(table)} and status = 'open'
        `;
        const sessionId = existing[0]?.id;
        const pending = sessionId ? await pendingOf(sessionId) : 0;

        if (!sessionId || action < 0.25) {
          const placed = await place(table, [pick([milanesa, cerveza])]);
          lineToCancel = {
            line: placed.lines[0]!.lineId,
            order: placed.orderId
          };
        } else if (action < 0.6 && pending > 0) {
          const method = pick(methods);
          const amount =
            random() < 0.4 ? null : 1 + Math.floor(random() * pending);
          const tip = random() < 0.3 ? Math.floor(random() * 800) : 0;
          const result = await pay("ana", sessionId, {
            amountCents: amount,
            method,
            tipCents: tip
          });
          expect(result.status, label).toBe(200);
          const collected = (amount ?? pending) + tip;
          if (method === "cash") cash += collected;
          payments.push({
            id: result.body.data.paymentId,
            method,
            remaining: collected
          });
        } else if (action < 0.7 && lineToCancel) {
          await admin`
            select private.cancel_order_item(
              ${one.tenantId}::uuid, ${locationOne}::uuid, ${managerId()}::uuid,
              ${next()}::uuid, ${lineToCancel.order}::uuid, ${lineToCancel.line}::uuid, 'Prueba'
            )
          `.catch(() => undefined);
          lineToCancel = null;
        } else if (action < 0.85 && pending < 0 && payments.length > 0) {
          const target = pick(
            payments.filter((payment) => payment.remaining > 0)
          );
          if (!target) continue;
          const amount =
            1 + Math.floor(random() * Math.min(-pending, target.remaining));
          const result = await refund("marta", sessionId, {
            amountCents: amount,
            paymentId: target.id
          });
          expect(result.status, label).toBe(200);
          target.remaining -= amount;
          if (target.method === "cash") cash -= amount;
        } else {
          const kind = random() < 0.5 ? "cash_in" : "cash_out";
          const amount = 1 + Math.floor(random() * 1_500);
          const result = await staff(
            "marta",
            "POST",
            "/v1/staff/cash-register/movements",
            {
              amountCents: amount,
              commandId: next(),
              kind,
              reason: "Prueba"
            }
          );
          expect(result.status, label).toBe(200);
          cash += kind === "cash_in" ? amount : -amount;
        }
      }

      // Blind close: a wrong count never closes, the right one does with no reason.
      const off = await closeShift("marta", cash + 1);
      expect(off.body.data, `seed ${seed}`).toMatchObject({
        closed: false,
        differenceCents: 1
      });
      const done = await closeShift("marta", cash);
      expect(done.body.data, `seed ${seed}`).toMatchObject({
        closed: true,
        differenceCents: 0,
        expectedCashCents: cash
      });
    }
  }, 120_000);

  it("keeps every shift record immutable and audited", async () => {
    await expect(
      admin`update private.cash_shift_closures set difference_cents = 0 where tenant_id = ${one.tenantId}`
    ).rejects.toMatchObject({ code: "PT209" });
    await expect(
      admin`delete from private.cash_movements where tenant_id = ${one.tenantId}`
    ).rejects.toMatchObject({ code: "PT209" });
    await expect(
      admin`update private.cash_shifts set opening_cash_cents = 1 where tenant_id = ${one.tenantId}`
    ).rejects.toMatchObject({ code: "PT209" });
    const [audits] = await admin<{ count: number }[]>`
      select count(*)::int as count from private.audit_events
      where tenant_id = ${one.tenantId}
        and action in ('cash_shift.opened', 'cash_shift.closed', 'account.refund_recorded')
    `;
    expect(audits?.count).toBeGreaterThan(4);
  });
});
