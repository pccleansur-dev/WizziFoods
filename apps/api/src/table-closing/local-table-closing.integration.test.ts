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
  slug: "close-it-1",
  tenantId: "31000000-0000-4000-8000-000000000013",
  userId: "31000000-0000-4000-8000-000000000011"
};
const two: Fixture = {
  slug: "close-it-2",
  tenantId: "31000000-0000-4000-8000-000000000023",
  userId: "31000000-0000-4000-8000-000000000021"
};

const level = "31100000-0000-4000-8000-0000000000f1";
const sectorSalon = "31100000-0000-4000-8000-000000000001";
const categoryId = "31300000-0000-4000-8000-000000000003";
const kitchenSector = "31300000-0000-4000-8000-000000000002";
const barSector = "31300000-0000-4000-8000-000000000004";
const milanesa = "31300000-0000-4000-8000-000000000001";
const cerveza = "31300000-0000-4000-8000-000000000005";
const prices: Record<string, number> = { [cerveza]: 4_000, [milanesa]: 12_500 };
const tableCount = 40;
const tableId = (n: number) =>
  `31200000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function uuid(seed: number): string {
  return `ff310000-0000-4000-8000-${String(seed).padStart(12, "0")}`;
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

describeWithLocalStack("closing and cleaning with local Supabase", () => {
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
        await tx`delete from private.cashier_requests where tenant_id = ${tenant}`;
        await tx`delete from private.account_receipts where tenant_id = ${tenant}`;
        await tx`delete from private.receipt_counters where tenant_id = ${tenant}`;
        await tx`delete from private.online_payments where tenant_id = ${tenant}`;
        await tx`delete from private.cash_movements where tenant_id = ${tenant}`;
        await tx`delete from private.cash_shift_closures where tenant_id = ${tenant}`;
        await tx`delete from private.cash_shifts where tenant_id = ${tenant}`;
        await tx`delete from private.account_split_assignments where split_id in (select id from private.account_splits where tenant_id = ${tenant})`;
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

  async function stateOf(table: number): Promise<string> {
    const [row] = await admin<{ state: string }[]>`
      select private.waiter_table_state(
        ${one.tenantId}::uuid, ${locationOne}::uuid, ${tableId(table)}::uuid
      ) as state
    `;
    return row!.state;
  }

  const pay = (
    user: string,
    sessionId: string,
    body: Record<string, unknown> = {},
    commandId = next()
  ) =>
    staff(user, "POST", `/v1/staff/accounts/${sessionId}/payments`, {
      amountCents: null,
      commandId,
      method: "cash",
      tipCents: 0,
      ...body
    });
  const close = (user: string, sessionId: string, commandId = next()) =>
    staff(user, "POST", `/v1/staff/accounts/${sessionId}/close`, { commandId });
  const clean = (user: string, table: number, commandId = next()) =>
    staff(user, "POST", `/v1/staff/tables/${tableId(table)}/clean`, {
      commandId
    });
  const notify = (user: string, sessionId: string, commandId = next()) =>
    staff(user, "POST", `/v1/staff/accounts/${sessionId}/cashier-requests`, {
      commandId
    });

  beforeAll(async () => {
    await cleanup();
    for (const fixture of [one, two]) {
      await admin`insert into auth.users (id) values (${fixture.userId})`;
      await admin`
        insert into public.tenants (id, slug, name, status)
        values (${fixture.tenantId}, ${fixture.slug}, 'Close IT', 'active')
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
      x: 40 + (index % 10) * 120,
      y: 60 + Math.floor(index / 10) * 140
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
          tables: [{ ...tables[0], id: "31200000-0000-4000-8000-0000000000ff" }]
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
    await createStaff(one, locationOne, "luis", "waiter", []);
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
    for (const name of ["ana", "luis", "marta", "coco"]) await login(one, name);
    await login(two, "otra");
    expect(
      (
        await staff("marta", "POST", "/v1/staff/cash-register/open", {
          commandId: next(),
          openingCashCents: 0
        })
      ).status
    ).toBe(200);
  }, 90_000);

  afterAll(async () => {
    await app?.close();
    await cleanup();
    await admin.end();
  });

  it("closes a settled account, holds the table for cleaning and only then frees it", async () => {
    await place(1, [milanesa, cerveza]);
    const sessionId = await sessionOf(1);

    const early = await close("ana", sessionId);
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe("BALANCE_NOT_SETTLED");
    expect(await stateOf(1)).toBe("occupied");

    expect((await pay("ana", sessionId, { tipCents: 1_000 })).status).toBe(200);
    expect((await close("coco", sessionId)).status).toBe(403);
    expect((await close("luis", sessionId)).status).toBe(404);
    expect((await close("otra", sessionId)).status).toBe(404);

    const closed = await close("ana", sessionId);
    expect(closed.status).toBe(200);
    expect(closed.body.data.receipt).toMatchObject({
      invoiceNotice:
        "¿Necesitás factura? Por el momento, la facturación se realiza en caja",
      notice: "Comprobante de consumo — no válido como factura",
      number: 1,
      tableLabels: ["1"]
    });
    expect(closed.body.data.tables).toEqual([
      expect.objectContaining({ label: "1", state: "needs_cleaning" })
    ]);
    expect(await stateOf(1)).toBe("needs_cleaning");

    // Paid is not free: nobody can order on the table until it is cleaned.
    await expect(place(1, [cerveza])).rejects.toMatchObject({ code: "PT210" });

    const receipt = await staff(
      "ana",
      "GET",
      `/v1/staff/accounts/${sessionId}/receipt`
    );
    expect(receipt.body.data.summary).toMatchObject({
      consumedCents: 16_500,
      pendingCents: 0,
      tipCents: 1_000
    });
    expect(receipt.body.data.cashierRequest).toBeNull();
    expect(
      (await staff("luis", "GET", `/v1/staff/accounts/${sessionId}/receipt`))
        .status
    ).toBe(404);
    expect(
      (await staff("otra", "GET", `/v1/staff/accounts/${sessionId}/receipt`))
        .status
    ).toBe(404);

    const listed = await staff("ana", "GET", "/v1/staff/closed-accounts");
    expect(listed.body.data.accounts[0]).toMatchObject({
      receiptNumber: 1,
      sessionId,
      tableLabels: ["1"]
    });

    expect((await clean("coco", 1)).status).toBe(403);
    expect((await clean("luis", 1)).status).toBe(404);
    expect((await clean("otra", 1)).status).toBe(404);
    expect((await clean("ana", 3)).status).toBe(409);
    const cleaned = await clean("ana", 1);
    expect(cleaned.status).toBe(200);
    expect(cleaned.body.data).toEqual({
      state: "available",
      tableId: tableId(1)
    });
    expect(await stateOf(1)).toBe("available");
    expect((await clean("ana", 1)).body.error.code).toBe(
      "TABLE_NOT_PENDING_CLEANING"
    );

    await place(1, [cerveza]);
    expect(await sessionOf(1)).not.toBe(sessionId);
  });

  it("issues exactly one receipt when closes race, and replays a retried command", async () => {
    await place(2, [milanesa]);
    const sessionId = await sessionOf(2);
    expect((await pay("ana", sessionId)).status).toBe(200);

    const racing = await Promise.all(
      Array.from({ length: 6 }, () => close("ana", sessionId))
    );
    expect(racing.filter((r) => r.status === 200)).toHaveLength(1);
    const losers = racing.filter((r) => r.status !== 200);
    expect(losers).toHaveLength(5);
    expect(new Set(losers.map((r) => r.body.error.code as string))).toEqual(
      new Set(["ACCOUNT_ALREADY_CLOSED"])
    );
    const [count] = await admin<{ total: number }[]>`
      select count(*)::int as total from private.account_receipts
      where session_id = ${sessionId}`;
    expect(count!.total).toBe(1);

    // The same command, even six times at once, always answers the same thing.
    await place(3, [milanesa]);
    const second = await sessionOf(3);
    expect((await pay("ana", second)).status).toBe(200);
    const command = next();
    const replay = await Promise.all(
      Array.from({ length: 6 }, () => close("ana", second, command))
    );
    expect(replay.every((r) => r.status === 200)).toBe(true);
    expect(new Set(replay.map((r) => JSON.stringify(r.body.data))).size).toBe(
      1
    );
    const numbers = await admin<{ number: number }[]>`
      select number from private.account_receipts
      where tenant_id = ${one.tenantId} order by number`;
    expect(numbers.map((row) => row.number)).toEqual(
      numbers.map((_, index) => index + 1)
    );
  });

  it("never lets a payment or an order slip into an account that is closing", async () => {
    for (let round = 0; round < 6; round += 1) {
      const table = 10 + round;
      await place(table, [cerveza]);
      const sessionId = await sessionOf(table);
      expect((await pay("ana", sessionId)).status).toBe(200);
      // The balance is zero. A closing, a new order and a fresh payment race.
      const outcome = await Promise.allSettled([
        close("ana", sessionId),
        place(table, [milanesa]),
        pay("marta", sessionId)
      ]);
      expect(outcome[0].status).toBe("fulfilled");
      const attempt = (
        outcome[0] as PromiseFulfilledResult<{
          body: { error?: { code: string } };
          status: number;
        }>
      ).value;
      const settled = await admin<{ status: string }[]>`
        select status from private.table_sessions where id = ${sessionId}`;
      if (attempt.status === 200) {
        expect(settled[0]!.status).toBe("closed");
        // Nothing but a refund may be written after the close: the receipt issued at
        // that moment still equals the ledger, and no entry is newer than the close.
        const [frozen] = await admin<
          { current: Record<string, number>; issued: Record<string, number> }[]
        >`
          select receipt.body -> 'summary' as issued,
            private.account_summary(
              ${one.tenantId}::uuid, ${locationOne}::uuid, ${sessionId}::uuid
            ) as current
          from private.account_receipts receipt where receipt.session_id = ${sessionId}`;
        expect(frozen!.current).toEqual(frozen!.issued);
        const [stray] = await admin<{ total: number }[]>`
          select count(*)::int as total
          from private.account_entries entry
          join private.table_sessions account_session
            on account_session.id = entry.session_id
          where entry.session_id = ${sessionId}
            and entry.kind <> 'refund'
            and entry.created_at > account_session.closed_at`;
        expect(stray!.total).toBe(0);
        expect(await pendingOf(sessionId)).toBe(0);
        expect(await stateOf(table)).toBe("needs_cleaning");
      } else {
        // The order won the race: the close saw a balance and was refused, so the
        // account (and the table) stay as they were until someone settles it.
        expect(attempt.status).toBe(409);
        expect(attempt.body.error?.code).toBe("BALANCE_NOT_SETTLED");
        expect(settled[0]!.status).toBe("open");
        expect(await stateOf(table)).toBe("occupied");
      }
    }
  });

  it("lets only one of several simultaneous cleanings win", async () => {
    await place(20, [cerveza]);
    const sessionId = await sessionOf(20);
    expect((await pay("ana", sessionId)).status).toBe(200);
    expect((await close("ana", sessionId)).status).toBe(200);
    const racing = await Promise.all([
      clean("ana", 20),
      clean("marta", 20),
      clean("ana", 20),
      clean("marta", 20)
    ]);
    expect(racing.filter((r) => r.status === 200)).toHaveLength(1);
    expect(racing.filter((r) => r.status === 409)).toHaveLength(3);
    expect(await stateOf(20)).toBe("available");
  });

  it("asks the cashier once, keeps fiscal data out and lets only the manager resolve it", async () => {
    await place(21, [milanesa]);
    const sessionId = await sessionOf(21);
    expect((await notify("ana", sessionId)).body.error.code).toBe(
      "RECEIPT_NOT_READY"
    );
    expect((await pay("ana", sessionId)).status).toBe(200);
    expect((await close("ana", sessionId)).status).toBe(200);

    expect((await notify("coco", sessionId)).status).toBe(403);
    expect(
      (
        await staff(
          "ana",
          "POST",
          `/v1/staff/accounts/${sessionId}/cashier-requests`,
          {
            commandId: next(),
            cuit: "20-12345678-9"
          }
        )
      ).status
    ).toBe(400);
    const requests = await Promise.all([
      notify("ana", sessionId),
      notify("ana", sessionId),
      notify("marta", sessionId)
    ]);
    expect(requests.every((r) => r.status === 200)).toBe(true);
    const ids = new Set(requests.map((r) => r.body.data.requestId as string));
    expect(ids.size).toBe(1);
    const [stored] = await admin<{ total: number }[]>`
      select count(*)::int as total from private.cashier_requests
      where session_id = ${sessionId}`;
    expect(stored!.total).toBe(1);
    const requestId = [...ids][0]!;

    const receipt = await staff(
      "ana",
      "GET",
      `/v1/staff/accounts/${sessionId}/receipt`
    );
    expect(receipt.body.data.cashierRequest).toEqual({
      requestId,
      status: "open"
    });
    expect(
      (
        await staff(
          "ana",
          "POST",
          `/v1/staff/cashier-requests/${requestId}/resolve`,
          {
            commandId: next()
          }
        )
      ).status
    ).toBe(403);
    expect(
      (
        await staff(
          "otra",
          "POST",
          `/v1/staff/cashier-requests/${requestId}/resolve`,
          {
            commandId: next()
          }
        )
      ).status
    ).toBe(404);
    const resolved = await staff(
      "marta",
      "POST",
      `/v1/staff/cashier-requests/${requestId}/resolve`,
      { commandId: next() }
    );
    expect(resolved.status).toBe(200);
    expect(resolved.body.data).toEqual({ requestId, status: "resolved" });
    const again = await notify("ana", sessionId);
    expect(again.body.data.requestId).not.toBe(requestId);
  });

  it("voids an unfinished split and refuses to close with money still to be returned", async () => {
    await place(22, [milanesa, cerveza]);
    const sessionId = await sessionOf(22);
    const made = await staff(
      "ana",
      "POST",
      `/v1/staff/accounts/${sessionId}/splits`,
      {
        commandId: next(),
        parts: 2
      }
    );
    expect(made.status).toBe(200);
    const splitId = made.body.data.split.splitId as string;
    await admin`
      insert into private.online_payments (
        tenant_id, location_id, share_split_id, share_position, amount_cents,
        status, provider_payment_id, provider_status, fulfillment
      ) values (
        ${one.tenantId}, ${locationOne}, ${splitId}, 1, 8250, 'approved',
        'MP-IT-26', 'approved', 'needs_refund'
      )`;
    expect((await pay("ana", sessionId)).status).toBe(200);

    const blocked = await close("ana", sessionId);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("ONLINE_REFUND_PENDING");
    expect(await stateOf(22)).toBe("occupied");

    await admin`
      update private.online_payments
      set fulfillment = 'closed', refunded_cents = amount_cents
      where provider_payment_id = 'MP-IT-26'`;
    expect((await close("ana", sessionId)).status).toBe(200);
    const [voided] = await admin<{ status: string; open: number }[]>`
      select split.status,
        (select count(*)::int from private.account_split_shares share
          where share.split_id = split.id and share.status in ('open', 'claimed')) as open
      from private.account_splits split where split.id = ${splitId}`;
    expect(voided).toEqual({ open: 0, status: "superseded" });
  });
});
