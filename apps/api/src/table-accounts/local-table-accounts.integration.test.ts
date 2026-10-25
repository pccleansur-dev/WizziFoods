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
  slug: "account-it-1",
  tenantId: "1f000000-0000-4000-8000-000000000013",
  userId: "1f000000-0000-4000-8000-000000000011"
};
const two: Fixture = {
  slug: "account-it-2",
  tenantId: "1f000000-0000-4000-8000-000000000023",
  userId: "1f000000-0000-4000-8000-000000000021"
};

const level = "1f100000-0000-4000-8000-0000000000f1";
const sectorSalon = "1f100000-0000-4000-8000-000000000001";
const sectorTerrace = "1f100000-0000-4000-8000-000000000002";
const categoryId = "1f300000-0000-4000-8000-000000000003";
const kitchenSector = "1f300000-0000-4000-8000-000000000002";
const barSector = "1f300000-0000-4000-8000-000000000004";
const milanesa = "1f300000-0000-4000-8000-000000000001";
const cerveza = "1f300000-0000-4000-8000-000000000005";
const vino = "1f300000-0000-4000-8000-000000000006";
const pollo = "1f300000-0000-4000-8000-000000000007";
const prices: Record<string, number> = {
  [cerveza]: 4_000,
  [milanesa]: 12_500,
  [pollo]: 9_000,
  [vino]: 6_900
};
const productIds = [milanesa, cerveza, vino, pollo];
const tableCount = 24;
const tableId = (n: number) =>
  `1f200000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function uuid(seed: number): string {
  return `ff600000-0000-4000-8000-${String(seed).padStart(12, "0")}`;
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

type Summary = {
  consumedCents: number;
  discountCents: number;
  paidCents: number;
  pendingCents: number;
  refundedCents: number;
  tipCents: number;
};

describeWithLocalStack("table accounts with local Supabase", () => {
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

  const manager = () => staffIds.get(`${one.slug}:marta`)!;
  const kitchenStaff = () => staffIds.get(`${one.slug}:coco`)!;
  const barStaff = () => staffIds.get(`${one.slug}:beto`)!;

  /** A manual order on a table, as the manager, straight through SQL. */
  async function place(table: number, products: string[]) {
    const lines = products.map((productId) => ({
      lineId: next(),
      productId,
      quantity: 1,
      variantId: null
    }));
    const [row] = await admin<{ result: { orderId: string } }[]>`
      select private.create_manual_order(
        ${one.tenantId}::uuid, ${locationOne}::uuid, ${manager()}::uuid,
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

  async function summary(sessionId: string): Promise<Summary> {
    const [row] = await admin<{ result: Summary }[]>`
      select private.account_summary(
        ${one.tenantId}::uuid, ${locationOne}::uuid, ${sessionId}::uuid
      ) as result
    `;
    return row!.result;
  }

  async function verified(sessionId: string) {
    const [row] = await admin<{ result: { matches: boolean } }[]>`
      select private.verify_account(
        ${one.tenantId}::uuid, ${locationOne}::uuid, ${sessionId}::uuid
      ) as result
    `;
    return row!.result.matches;
  }

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

  beforeAll(async () => {
    await cleanup();
    for (const fixture of [one, two]) {
      await admin`insert into auth.users (id) values (${fixture.userId})`;
      await admin`
        insert into public.tenants (id, slug, name, status)
        values (${fixture.tenantId}, ${fixture.slug}, 'Account IT', 'active')
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
      sectorId: index % 2 === 0 ? sectorSalon : sectorTerrace,
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
          sectors: [
            { id: sectorSalon, name: "Salón", position: 0 },
            { id: sectorTerrace, name: "Terraza", position: 1 }
          ],
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
          tables: [{ ...tables[0], id: "1f200000-0000-4000-8000-0000000000ff" }]
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
            product(cerveza, "Cerveza", barSector, 1),
            product(vino, "Vino", barSector, 2),
            product(pollo, "Pollo", kitchenSector, 3)
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
    // Collecting needs an open register (T23).
    await admin`
      select private.open_cash_shift(
        ${one.tenantId}::uuid, ${locationOne}::uuid, ${manager()}::uuid,
        ${next()}::uuid, 0
      )
    `;

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
    await login(two, "otro");
  }, 90_000);

  afterAll(async () => {
    await app?.close();
    await cleanup();
    await admin.end();
  });

  it("limits each operation to the roles that own it", async () => {
    await place(1, [milanesa]);
    const sessionId = await sessionOf(1);
    expect((await staff("coco", "GET", "/v1/staff/accounts")).status).toBe(403);
    expect((await pay("coco", sessionId, {})).status).toBe(403);
    expect(
      (
        await staff(
          "ana",
          "POST",
          `/v1/staff/accounts/${sessionId}/discounts`,
          {
            commandId: next(),
            kind: "percent",
            reason: "x",
            value: 100
          }
        )
      ).status
    ).toBe(403);
    expect((await pay("bruno", sessionId, {})).status).toBe(404);
    expect((await pay("otro", sessionId, {})).status).toBe(404);
    const forged = await staff(
      "ana",
      "POST",
      `/v1/staff/accounts/${sessionId}/payments`,
      {
        amountCents: 100,
        commandId: next(),
        currency: "USD",
        method: "cash",
        tipCents: 0
      }
    );
    expect(forged.status).toBe(400);
    const online = await pay("ana", sessionId, { method: "mercado_pago" });
    expect(online.status).toBe(400);
    const anonymous = await app!
      .getHttpAdapter()
      .getInstance()
      .inject({ method: "GET", url: "/v1/staff/accounts" });
    expect(anonymous.statusCode).toBe(401);
  });

  it("derives the balance from the ledger and collects it with a tip", async () => {
    await place(3, [milanesa, cerveza]);
    const sessionId = await sessionOf(3);
    const view = await staff("ana", "GET", "/v1/staff/accounts");
    const account = view.body.data.accounts.find(
      (entry: { sessionId: string }) => entry.sessionId === sessionId
    );
    expect(account.summary).toMatchObject({
      consumedCents: 16_500,
      pendingCents: 16_500
    });
    expect(account.entries).toHaveLength(2);
    const partial = await pay("ana", sessionId, {
      amountCents: 10_000,
      tipCents: 500
    });
    expect(partial.status).toBe(200);
    expect(partial.body.data).toMatchObject({
      paymentCents: 10_500,
      pendingCents: 6_500
    });
    expect((await pay("ana", sessionId, { amountCents: 99_999 })).status).toBe(
      409
    );
    const rest = await pay("ana", sessionId, { method: "credit_card" });
    expect(rest.body.data.pendingCents).toBe(0);
    const again = await pay("ana", sessionId, { amountCents: 1 });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("NOTHING_TO_COLLECT");
    expect(await verified(sessionId)).toBe(true);
  });

  it("grants a discount only as the manager and keeps an account open on request", async () => {
    await place(5, [milanesa]);
    const sessionId = await sessionOf(5);
    const discount = await staff(
      "marta",
      "POST",
      `/v1/staff/accounts/${sessionId}/discounts`,
      {
        commandId: next(),
        kind: "percent",
        reason: "Cliente frecuente",
        value: 1_000
      }
    );
    expect(discount.status).toBe(200);
    expect(discount.body.data).toMatchObject({
      discountCents: 1_250,
      pendingCents: 11_250
    });
    const kept = await staff(
      "ana",
      "POST",
      `/v1/staff/accounts/${sessionId}/keep-open`,
      {
        commandId: next()
      }
    );
    expect(kept.body.data).toMatchObject({
      decision: "keep_open",
      pendingCents: 11_250
    });
  });

  it("never duplicates a payment under concurrent retries and charges the rest once", async () => {
    await place(7, [milanesa, vino]);
    const sessionId = await sessionOf(7);
    const commandId = next();
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        pay("ana", sessionId, { amountCents: 5_000 }, commandId)
      )
    );
    for (const result of results) expect(result.status).toBe(200);
    expect(
      new Set(results.map((result) => JSON.stringify(result.body))).size
    ).toBe(1);
    const [payments] = await admin<{ count: number }[]>`
      select count(*)::int as count from private.account_entries
      where session_id = ${sessionId} and kind = 'payment'
    `;
    expect(payments?.count).toBe(1);

    // Two different commands for the whole balance: only one can win.
    const race = await Promise.all([
      pay("ana", sessionId, {}),
      pay("marta", sessionId, {}),
      pay("ana", sessionId, {})
    ]);
    expect(race.filter((result) => result.status === 200)).toHaveLength(1);
    expect(race.filter((result) => result.status === 409)).toHaveLength(2);
    expect((await summary(sessionId)).pendingCents).toBe(0);
    expect(await verified(sessionId)).toBe(true);
  });

  it("opens one session when two orders are confirmed at the same time", async () => {
    await Promise.all([
      place(9, [milanesa]),
      place(9, [cerveza]),
      place(9, [vino])
    ]);
    const [count] = await admin<{ count: number }[]>`
      select count(*)::int as count from private.table_sessions
      where tenant_id = ${one.tenantId} and scope_key = ${tableId(9)}
    `;
    expect(count?.count).toBe(1);
    const sessionId = await sessionOf(9);
    expect((await summary(sessionId)).consumedCents).toBe(
      12_500 + 4_000 + 6_900
    );
    expect(await verified(sessionId)).toBe(true);
  });

  it("keeps the ledger consistent with an independent model over random sequences", async () => {
    // Fixed seeds keep it reproducible: a failure names the seed and step.
    for (let sequence = 0; sequence < 12; sequence += 1) {
      const seed = 9_000 + sequence;
      const random = generator(seed);
      const table = 10 + sequence;
      const pick = <T>(items: T[]) =>
        items[Math.floor(random() * items.length)]!;
      let consumed = 0;
      let discounts = 0;
      let tips = 0;
      let paid = 0;
      const open: {
        line: string;
        order: string;
        product: string;
        total: number;
      }[] = [];

      for (let step = 0; step < 14; step += 1) {
        const label = `seed ${seed} step ${step}`;
        const action = random();
        const session = await admin<{ id: string }[]>`
          select id from private.table_sessions
          where tenant_id = ${one.tenantId} and scope_key = ${tableId(table)} and status = 'open'
        `;
        const sessionId = session[0]?.id;
        const pending = sessionId ? (await summary(sessionId)).pendingCents : 0;

        if (!sessionId || action < 0.3) {
          const products = Array.from(
            { length: 1 + Math.floor(random() * 3) },
            () => pick(productIds)
          );
          const placed = await place(table, products);
          for (const [index, line] of placed.lines.entries()) {
            consumed += prices[line.productId]!;
            open.push({
              line: line.lineId,
              order: placed.orderId,
              product: products[index]!,
              total: prices[line.productId]!
            });
          }
        } else if (action < 0.45 && open.length > 0) {
          const target = open.splice(Math.floor(random() * open.length), 1)[0]!;
          await admin`
            select private.cancel_order_item(
              ${one.tenantId}::uuid, ${locationOne}::uuid, ${manager()}::uuid,
              ${next()}::uuid, ${target.order}::uuid, ${target.line}::uuid, 'Prueba'
            )
          `;
          consumed -= target.total;
        } else if (action < 0.55 && open.length > 0) {
          const target = open.splice(Math.floor(random() * open.length), 1)[0]!;
          const [kind] = await admin<{ sector_kind: string }[]>`
            select sector_kind from private.production_items
            where order_id = ${target.order} and line_id = ${target.line}
          `;
          const producer =
            kind?.sector_kind === "bar" ? barStaff() : kitchenStaff();
          await admin`
            select private.report_production_exception(
              ${one.tenantId}::uuid, ${locationOne}::uuid, ${producer}::uuid,
              ${next()}::uuid, ${target.order}::uuid, ${target.line}::uuid, 'Faltante'
            )
          `;
          const replacement = pick(productIds);
          const [proposal] = await admin<
            { result: { adjustmentId: string } }[]
          >`
            select private.propose_item_replacement(
              ${one.tenantId}::uuid, ${locationOne}::uuid, ${manager()}::uuid,
              ${next()}::uuid, ${target.order}::uuid, ${target.line}::uuid,
              ${replacement}::uuid, null
            ) as result
          `;
          const [decided] = await admin<
            { result: { replacementLineId: string } }[]
          >`
            select private.decide_item_replacement(
              ${one.tenantId}::uuid, ${locationOne}::uuid, ${manager()}::uuid,
              ${next()}::uuid, ${proposal!.result.adjustmentId}::uuid, 'accept', null
            ) as result
          `;
          consumed += prices[replacement]! - target.total;
          open.push({
            line: decided!.result.replacementLineId,
            order: target.order,
            product: replacement,
            total: prices[replacement]!
          });
        } else if (action < 0.8 && pending > 0) {
          const amount =
            random() < 0.4 ? null : 1 + Math.floor(random() * pending);
          const tip = random() < 0.3 ? Math.floor(random() * 1_000) : 0;
          const result = await pay(
            "ana",
            sessionId,
            { amountCents: amount, tipCents: tip },
            next()
          );
          if (table % 2 === 0) {
            // Even tables belong to the terrace: the salon waiter must be refused.
            expect(result.status, label).toBe(404);
            continue;
          }
          expect(result.status, label).toBe(200);
          const taken = amount ?? pending;
          paid += taken + tip;
          tips += tip;
        } else if (pending > 1) {
          const percent = random() < 0.5;
          const value = percent
            ? 1 + Math.floor(random() * 10_000)
            : 1 + Math.floor(random() * pending);
          const expected = percent
            ? Math.floor((pending * value + 5_000) / 10_000)
            : value;
          const result = await staff(
            "marta",
            "POST",
            `/v1/staff/accounts/${sessionId}/discounts`,
            {
              commandId: next(),
              kind: percent ? "percent" : "amount",
              reason: "Prueba",
              value
            }
          );
          if (expected <= 0) {
            expect(result.status, label).toBe(400);
            continue;
          }
          expect(result.status, label).toBe(200);
          expect(result.body.data.discountCents, label).toBe(expected);
          discounts += expected;
        }

        const current = await admin<{ id: string }[]>`
          select id from private.table_sessions
          where tenant_id = ${one.tenantId} and scope_key = ${tableId(table)} and status = 'open'
        `;
        if (!current[0]) continue;
        const state = await summary(current[0].id);
        expect(state, label).toMatchObject({
          consumedCents: consumed,
          discountCents: discounts,
          paidCents: paid,
          tipCents: tips
        });
        // Pending always follows from its parts; it can go below zero only when an
        // item is cancelled after having been paid.
        expect(state.pendingCents, label).toBe(
          consumed - discounts + tips - paid
        );
        expect(await verified(current[0].id), label).toBe(true);
      }
    }
  }, 120_000);

  it("never lets a movement break the sign rules or be rewritten", async () => {
    const [bad] = await admin<{ count: number }[]>`
      select count(*)::int as count from private.account_entries
      where tenant_id = ${one.tenantId}
        and ((kind in ('charge', 'tip', 'refund') and amount_cents <= 0)
          or (kind in ('discount', 'payment') and amount_cents >= 0))
    `;
    expect(bad?.count).toBe(0);
    await expect(
      admin`update private.account_entries set amount_cents = amount_cents + 1 where tenant_id = ${one.tenantId}`
    ).rejects.toMatchObject({ code: "PT209" });
    await expect(
      admin`delete from private.account_entries where tenant_id = ${one.tenantId}`
    ).rejects.toMatchObject({ code: "PT209" });
    const [audits] = await admin<{ count: number }[]>`
      select count(*)::int as count from private.audit_events
      where tenant_id = ${one.tenantId} and action = 'account.payment_recorded'
    `;
    expect(audits?.count).toBeGreaterThan(0);
  });
});
