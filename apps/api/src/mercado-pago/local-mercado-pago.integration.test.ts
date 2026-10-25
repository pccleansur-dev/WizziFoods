import { randomUUID } from "node:crypto";

import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication
} from "@nestjs/platform-fastify";
import type { ApiRuntimeConfig } from "@platform/config";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../app.module.js";
import { hashStaffPin } from "../staff-auth/pin-credential.js";
import {
  FAKE_MERCADO_PAGO,
  type FakeMercadoPago
} from "./fake-mercado-pago.controller.js";
import { MercadoPagoService } from "./mercado-pago.service.js";
import { signatureHeader } from "./webhook-signature.js";

const databaseUrl = process.env.DATABASE_URL;
const databaseAdminUrl = process.env.DATABASE_ADMIN_URL;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
const hasLocalStack =
  databaseUrl && databaseAdminUrl && supabaseUrl && supabaseSecretKey;
const describeWithLocalStack = hasLocalStack ? describe : describe.skip;

const pepper = "test-pepper-with-at-least-32-characters";
const pin = "135790";
const webhookSecret = "webhook-secret-123456";

type Fixture = {
  host: string;
  slug: string;
  tenantId: string;
  userId: string;
};

const one: Fixture = {
  host: "mp-it-1.plataforma.test",
  slug: "mp-it-1",
  tenantId: "2f000000-0000-4000-8000-000000000013",
  userId: "2f000000-0000-4000-8000-000000000011"
};
const two: Fixture = {
  host: "mp-it-2.plataforma.test",
  slug: "mp-it-2",
  tenantId: "2f000000-0000-4000-8000-000000000023",
  userId: "2f000000-0000-4000-8000-000000000021"
};

const level = "2f100000-0000-4000-8000-0000000000f1";
const sectorSalon = "2f100000-0000-4000-8000-000000000001";
const categoryId = "2f300000-0000-4000-8000-000000000003";
const kitchenSector = "2f300000-0000-4000-8000-000000000002";
const barSector = "2f300000-0000-4000-8000-000000000004";
const milanesa = "2f300000-0000-4000-8000-000000000001";
const cerveza = "2f300000-0000-4000-8000-000000000005";
const prices: Record<string, number> = { [cerveza]: 4_000, [milanesa]: 12_500 };
const tableId = (n: number) =>
  `2f200000-0000-4000-8000-${String(n).padStart(12, "0")}`;

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

function catalog() {
  return {
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
  };
}

describeWithLocalStack("Mercado Pago with local Supabase", () => {
  const admin = postgres(databaseAdminUrl ?? "", { prepare: false });
  let app: NestFastifyApplication | undefined;
  let fake: FakeMercadoPago;
  let service: MercadoPagoService;
  let locationOne = "";
  let locationTwo = "";
  let sellerOne = "";
  let sellerTwo = "";
  let managerToken = "";
  let waiterToken = "";
  let managerId = "";
  let counter = 1_000;
  const next = () =>
    `ff400000-0000-4000-8000-${String(counter++).padStart(12, "0")}`;
  let notification = 500_000;

  async function cleanup() {
    for (const fixture of [one, two]) {
      const tenant = fixture.tenantId;
      await admin.begin(async (tx) => {
        await tx`set local session_replication_role = replica`;
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
    await admin`delete from private.mp_webhook_events where data_id like '555%' or event_key like 'payment:5000%' or event_key like 'payment:5001%'`;
  }

  async function seedTenant(fixture: Fixture, tables: number) {
    await admin`insert into auth.users (id) values (${fixture.userId})`;
    await admin`
      insert into public.tenants (id, slug, name, status)
      values (${fixture.tenantId}, ${fixture.slug}, 'MP IT', 'active')
    `;
    await admin`
      insert into public.tenant_memberships (tenant_id, user_id, role)
      values (${fixture.tenantId}, ${fixture.userId}, 'admin')
    `;
    await admin`
      insert into public.tenant_domains (
        tenant_id, hostname, kind, status, is_primary
      ) values (
        ${fixture.tenantId}, ${fixture.host}, 'platform_subdomain', 'active', true
      )
    `;
    const [location] = await admin<{ id: string }[]>`
      select id from public.locations where tenant_id = ${fixture.tenantId}
    `;
    const planTables = Array.from({ length: tables }, (_, index) => ({
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
        ${fixture.tenantId}::uuid, ${location!.id}::uuid, ${fixture.userId}::uuid,
        ${next()}::uuid, 0, ${admin.json({
          floors: [{ id: level, name: "Salón", position: 0, shortName: null }],
          groups: [],
          sectors: [{ id: sectorSalon, name: "Salón", position: 0 }],
          tables: planTables
        })}
      )
    `;
    await admin`
      insert into private.location_publications (tenant_id, location_id, published_by)
      values (${fixture.tenantId}, ${location!.id}, ${fixture.userId})
    `;
    await admin`
      insert into private.published_catalogs (
        tenant_id, location_id, revision, source_draft_revision, snapshot, published_by
      ) values (
        ${fixture.tenantId}, ${location!.id}, 1, 1, ${admin.json(catalog())}, ${fixture.userId}
      )
    `;
    await admin`select private.ensure_payment_methods(${fixture.tenantId}::uuid, ${location!.id}::uuid)`;
    return location!.id;
  }

  async function staffLogin(username: string, role: string) {
    const hash = await hashStaffPin(pin, pepper);
    const [row] = await admin<{ result: { id: string } }[]>`
      select private.create_staff_member(
        ${one.tenantId}::uuid, ${locationOne}::uuid, ${one.userId}::uuid,
        ${username}, ${username}, ${role}, ${hash},
        ${role === "waiter" ? [sectorSalon] : []}::uuid[]
      ) as result
    `;
    const response = await app!
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "POST",
        payload: { pin, username },
        url: `/v1/tenants/${one.slug}/staff-sessions`
      });
    expect(response.statusCode).toBe(201);
    return {
      id: row!.result.id,
      token: response.json().data.accessToken as string
    };
  }

  /** The business owner authorizes in Mercado Pago and the browser comes back. */
  async function connect(fixture: Fixture, locationId: string) {
    const { authorizationUrl } = await service.startConnection(
      { locationId, tenantId: fixture.tenantId },
      fixture.userId
    );
    const consent = await app!
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "GET",
        url: authorizationUrl.replace(/^https?:\/\/[^/]+/u, "")
      });
    expect(consent.statusCode).toBe(302);
    const callback = String(consent.headers.location).replace(
      /^https?:\/\/[^/]+/u,
      ""
    );
    const back = await app!
      .getHttpAdapter()
      .getInstance()
      .inject({ method: "GET", url: callback });
    expect(back.statusCode).toBe(302);
    return String(back.headers.location);
  }

  async function tokenOf(table: number) {
    const [row] = await admin<{ token: string }[]>`
      select qr.token from private.floor_table_qr_codes qr
      where qr.tenant_id = ${one.tenantId} and qr.table_id = ${tableId(table)}
        and qr.status = 'active'
    `;
    return row!.token;
  }

  async function intent(table: number, product: string, quantity: number) {
    const [row] = await admin<
      { result: { intentId: string; totalCents: number } }[]
    >`
      select private.create_order_intent(
        ${one.tenantId}::uuid, ${locationOne}::uuid, ${await tokenOf(table)},
        ${next()}::uuid, 'table', 'Valentín', null, 'mercado_pago', 'online',
        ${admin.json([
          {
            lineId: next(),
            productId: product,
            quantity,
            variantId: null
          }
        ])}
      ) as result
    `;
    return { intentId: row!.result.intentId, token: await tokenOf(table) };
  }

  type DinerResponseBody = {
    data: {
      outcome: string;
      payment: { paymentId: string; [key: string]: unknown };
      [key: string]: unknown;
    };
  };

  async function diner(
    host: string,
    path: string,
    payload: unknown
  ): Promise<{ body: DinerResponseBody; status: number }> {
    const response = await app!
      .getHttpAdapter()
      .getInstance()
      .inject({
        headers: { host },
        method: "POST",
        payload: payload as object,
        url: `/v1/public/online-payments${path}`
      });
    return {
      body: response.json() as DinerResponseBody,
      status: response.statusCode
    };
  }

  const sandbox = (
    target: { intentId: string; token: string },
    outcome: "approved" | "pending" | "rejected"
  ) =>
    diner(one.host, "/pay", {
      ...target,
      method: { kind: "sandbox", outcome }
    });

  async function webhook(options: {
    dataId: string;
    header?: string | null;
    notificationId?: number;
    query?: string;
    requestId?: string;
    secret?: string;
    /** The id the signature is made for, when it differs from the query. */
    signedFor?: string;
    ts?: string;
    userId: string;
  }) {
    const requestId = options.requestId ?? randomUUID();
    const ts = options.ts ?? String(Math.floor(Date.now() / 1000));
    const signed = options.signedFor ?? options.query ?? options.dataId;
    const header =
      options.header === undefined
        ? signatureHeader(options.secret ?? webhookSecret, {
            dataId: signed,
            requestId,
            ts
          })
        : options.header;
    const response = await app!
      .getHttpAdapter()
      .getInstance()
      .inject({
        headers: {
          "x-request-id": requestId,
          ...(header === null ? {} : { "x-signature": header })
        },
        method: "POST",
        payload: {
          action: "payment.updated",
          api_version: "v1",
          data: { id: options.dataId },
          date_created: new Date().toISOString(),
          id: options.notificationId ?? notification++,
          live_mode: false,
          type: "payment",
          user_id: options.userId
        },
        url: `/v1/webhooks/mercado-pago?data.id=${options.query ?? options.dataId}&type=payment`
      });
    return { body: response.json(), status: response.statusCode };
  }

  async function row(paymentId: string) {
    const [payment] = await admin<
      {
        fulfillment: string;
        order_id: string | null;
        provider_payment_id: string;
        refunded_cents: number;
        session_id: string | null;
        status: string;
      }[]
    >`select * from private.online_payments where id = ${paymentId}`;
    return payment!;
  }

  async function ordersOf(intentId: string) {
    const [count] = await admin<{ count: number }[]>`
      select count(*)::int as count from private.confirmed_orders where intent_id = ${intentId}
    `;
    return count!.count;
  }

  async function pendingOf(sessionId: string) {
    const [summary] = await admin<{ pending: number }[]>`
      select (private.account_summary(
        ${one.tenantId}::uuid, ${locationOne}::uuid, ${sessionId}::uuid
      ) ->> 'pendingCents')::integer as pending
    `;
    return summary!.pending;
  }

  beforeAll(async () => {
    await cleanup();
    locationOne = await seedTenant(one, 6);
    locationTwo = await seedTenant(two, 2);
    await admin`
      insert into private.product_operational_stock (tenant_id, location_id, product_id, available_quantity)
      values (${one.tenantId}, ${locationOne}, ${cerveza}, 50)
    `;
    const config: ApiRuntimeConfig = {
      adminInviteRedirectUrl: "https://app.example.test/auth/callback",
      databaseUrl: databaseUrl ?? "",
      environment: "test",
      logLevel: "error",
      mercadoPago: {
        mode: "fake",
        redirectUri: "http://localhost:39001/v1/payments/mercado-pago/callback",
        returnUrl: "https://app.example.test/panel/pagos",
        webhookSecret
      },
      metricsPort: 9464,
      // Nothing listens here: the sandbox's own webhook deliveries fail quietly and
      // this test sends the signed notifications itself.
      paymentSecretKey: Buffer.alloc(32, 7),
      platformBaseDomain: "plataforma.test",
      port: 39_001,
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
    fake = app.get<FakeMercadoPago>(FAKE_MERCADO_PAGO);
    service = app.get(MercadoPagoService);

    const manager = await staffLogin("marta", "manager");
    managerToken = manager.token;
    managerId = manager.id;
    waiterToken = (await staffLogin("ana", "waiter")).token;

    expect(await connect(one, locationOne)).toContain("mp=connected");
    expect(await connect(two, locationTwo)).toContain("mp=connected");
    [sellerOne] = (
      await admin<
        { mp_user_id: string }[]
      >`select mp_user_id from private.mp_connections where tenant_id = ${one.tenantId}`
    ).map((entry) => entry.mp_user_id) as [string];
    [sellerTwo] = (
      await admin<
        { mp_user_id: string }[]
      >`select mp_user_id from private.mp_connections where tenant_id = ${two.tenantId}`
    ).map((entry) => entry.mp_user_id) as [string];
    await admin`
      select private.update_payment_method(
        ${one.tenantId}::uuid, ${locationOne}::uuid, ${one.userId}::uuid, 'mercado_pago', true, null
      )
    `;
  }, 90_000);

  afterAll(async () => {
    await app?.close();
    await cleanup();
    await admin.end();
  });

  it("connects each business with its own seller and keeps the credential sealed", async () => {
    expect(sellerOne).not.toBe(sellerTwo);
    const secrets = await admin<{ tenant_id: string; ciphertext: Buffer }[]>`
      select tenant_id, ciphertext from private.payment_method_secrets
      where tenant_id in (${one.tenantId}, ${two.tenantId})
    `;
    expect(secrets).toHaveLength(2);
    for (const secret of secrets) {
      expect(secret.ciphertext.includes(Buffer.from("TEST-"))).toBe(false);
      expect(secret.ciphertext.includes(Buffer.from("TESTREFRESH"))).toBe(
        false
      );
    }
    // The state of an authorization is valid once; a forged or reused one fails.
    const forged = await app!
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "GET",
        url: `/v1/payments/mercado-pago/callback?code=fake-123456789&state=${"A".repeat(43)}`
      });
    expect(String(forged.headers.location)).toContain("mp=expired");
    const malformed = await app!.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/v1/payments/mercado-pago/callback?code=x&state=y"
    });
    expect(String(malformed.headers.location)).toContain("mp=expired");
  });

  it("accredits a payment: the order, the account and production appear only then", async () => {
    const target = await intent(1, milanesa, 2);
    const start = await diner(one.host, "", target);
    expect(start.status).toBe(200);
    expect(start.body.data).toMatchObject({
      mode: "sandbox",
      payment: {
        amountCents: 25_000,
        fulfillment: "waiting",
        status: "created"
      }
    });
    expect(await ordersOf(target.intentId)).toBe(0);

    const paid = await sandbox(target, "approved");
    expect(paid.status).toBe(200);
    expect(paid.body.data).toMatchObject({
      intentStatus: "confirmed",
      payment: { fulfillment: "confirmed", status: "approved" }
    });
    const payment = await row(paid.body.data.payment.paymentId);
    expect(await ordersOf(target.intentId)).toBe(1);
    expect(await pendingOf(payment.session_id!)).toBe(0);
    const [order] = await admin<{ confirmed_by: string | null }[]>`
      select confirmed_by from private.confirmed_orders where id = ${payment.order_id}
    `;
    expect(order!.confirmed_by).toBeNull();
    const [production] = await admin<{ count: number }[]>`
      select count(*)::int as count from private.production_items where order_id = ${payment.order_id}
    `;
    expect(production!.count).toBe(1);
    const [entry] = await admin<
      {
        actor_type: string;
        amount_cents: number;
        payment_method: string;
        shift_id: string | null;
      }[]
    >`
      select actor_type, amount_cents, payment_method, shift_id from private.account_entries
      where source_id = ${paid.body.data.payment.paymentId} and kind = 'payment'
    `;
    expect(entry).toEqual({
      actor_type: "system",
      amount_cents: -25_000,
      payment_method: "mercado_pago",
      shift_id: null
    });

    // Trying to pay again does not charge twice nor create a second order.
    await sandbox(target, "approved");
    expect(await ordersOf(target.intentId)).toBe(1);
    const [attempts] = await admin<{ count: number }[]>`
      select count(*)::int as count from private.online_payments where intent_id = ${target.intentId}
    `;
    expect(attempts!.count).toBe(1);
  });

  it("keeps a pending payment out of the account until Mercado Pago accredits it", async () => {
    const target = await intent(2, milanesa, 1);
    const pending = await sandbox(target, "pending");
    expect(pending.body.data).toMatchObject({
      intentStatus: "payment_pending",
      payment: { fulfillment: "waiting", status: "pending" }
    });
    const paymentId = pending.body.data.payment.paymentId as string;
    expect(await ordersOf(target.intentId)).toBe(0);
    const [entries] = await admin<{ count: number }[]>`
      select count(*)::int as count from private.account_entries
      where tenant_id = ${one.tenantId} and source_id = ${paymentId}
    `;
    expect(entries!.count).toBe(0);

    // The provider decides later; the signed notification makes us ask for the state.
    const providerId = (await row(paymentId)).provider_payment_id;
    fake.gateway.simulate(providerId, { status: "approved" });
    const accredited = await webhook({ dataId: providerId, userId: sellerOne });
    expect(accredited).toEqual({
      body: { data: { outcome: "applied" } },
      status: 200
    });
    expect(await ordersOf(target.intentId)).toBe(1);
    const status = await diner(one.host, "/status", target);
    expect(status.body.data).toMatchObject({
      intentStatus: "confirmed",
      payment: { status: "approved" }
    });
  });

  it("refuses a rejected payment, keeps the order unconfirmed and allows another attempt", async () => {
    const target = await intent(3, milanesa, 1);
    const rejected = await sandbox(target, "rejected");
    expect(rejected.body.data).toMatchObject({
      intentStatus: "payment_pending",
      payment: { status: "rejected", statusDetail: "cc_rejected_other_reason" }
    });
    expect(await ordersOf(target.intentId)).toBe(0);

    const retry = await sandbox(target, "approved");
    expect(retry.body.data).toMatchObject({
      intentStatus: "confirmed",
      payment: { status: "approved" }
    });
    expect(retry.body.data.payment.paymentId).not.toBe(
      rejected.body.data.payment.paymentId
    );
    expect(await ordersOf(target.intentId)).toBe(1);
  });

  it("authenticates the webhook: no signature, a forged one or a tampered id changes nothing", async () => {
    const target = await intent(4, milanesa, 1);
    const pending = await sandbox(target, "pending");
    const providerId = (await row(pending.body.data.payment.paymentId))
      .provider_payment_id;
    fake.gateway.simulate(providerId, { status: "approved" });

    expect(
      (await webhook({ dataId: providerId, header: null, userId: sellerOne }))
        .status
    ).toBe(401);
    expect(
      (
        await webhook({
          dataId: providerId,
          secret: "not-the-secret-123456",
          userId: sellerOne
        })
      ).status
    ).toBe(401);
    // A valid signature for another payment does not authorize this one.
    expect(
      (
        await webhook({
          dataId: providerId,
          query: "9999999",
          signedFor: providerId,
          userId: sellerOne
        })
      ).status
    ).toBe(401);
    expect(
      (
        await webhook({
          dataId: providerId,
          header: `ts=${Math.floor(Date.now() / 1000) - 3 * 86_400},v1=${"0".repeat(64)}`,
          userId: sellerOne
        })
      ).status
    ).toBe(401);
    // The query and the body must name the same payment.
    const mismatch = await webhook({
      dataId: providerId,
      query: "5559999",
      userId: sellerOne,
      header: signatureHeader(webhookSecret, {
        dataId: "5559999",
        requestId: "r-1",
        ts: String(Math.floor(Date.now() / 1000))
      }),
      requestId: "r-1"
    });
    expect(mismatch.status).toBe(400);
    expect(await ordersOf(target.intentId)).toBe(0);
    expect((await row(pending.body.data.payment.paymentId)).status).toBe(
      "pending"
    );

    // With a valid signature the same notification applies.
    expect(
      (await webhook({ dataId: providerId, userId: sellerOne })).body.data
        .outcome
    ).toBe("applied");
    expect(await ordersOf(target.intentId)).toBe(1);
  });

  it("deduplicates and survives a replay of the same notification", async () => {
    const target = await intent(5, milanesa, 1);
    const pending = await sandbox(target, "pending");
    const paymentId = pending.body.data.payment.paymentId as string;
    const providerId = (await row(paymentId)).provider_payment_id;
    fake.gateway.simulate(providerId, { status: "approved" });

    const id = notification++;
    const requestId = randomUUID();
    const ts = String(Math.floor(Date.now() / 1000));
    const send = () =>
      webhook({
        dataId: providerId,
        notificationId: id,
        requestId,
        ts,
        userId: sellerOne
      });
    const results = await Promise.all([send(), send(), send()]);
    const outcomes = results.map((result) => result.body.data.outcome).sort();
    expect(results.every((result) => result.status === 200)).toBe(true);
    expect(outcomes.filter((outcome) => outcome === "applied")).toHaveLength(1);
    // Never more than one order and one payment movement, whatever the repeats.
    expect(await ordersOf(target.intentId)).toBe(1);
    const [movements] = await admin<{ count: number }[]>`
      select count(*)::int as count from private.account_entries
      where source_id = ${paymentId} and kind = 'payment'
    `;
    expect(movements!.count).toBe(1);
    // A later replay of the very same signed message is a recognised duplicate.
    const replay = await send();
    expect(replay.body.data.outcome).toBe("duplicate");
    const [events] = await admin<{ count: number }[]>`
      select count(*)::int as count from private.mp_webhook_events where event_key = ${`payment:${id}`}
    `;
    expect(events!.count).toBe(1);
  });

  it("does not let a late notification downgrade an accredited payment", async () => {
    const target = await intent(6, milanesa, 1);
    const approved = await sandbox(target, "approved");
    const paymentId = approved.body.data.payment.paymentId as string;
    const providerId = (await row(paymentId)).provider_payment_id;
    // An older "pending" announcement arrives after the approval: the state is
    // fetched, so it sees the accredited payment and changes nothing.
    const late = await webhook({ dataId: providerId, userId: sellerOne });
    expect(late.body.data.outcome).toBe("unchanged");
    expect((await row(paymentId)).status).toBe("approved");
    expect(await ordersOf(target.intentId)).toBe(1);
    // Even a provider that wrongly went back to pending cannot undo the order.
    fake.gateway.simulate(providerId, { status: "pending" });
    const downgrade = await webhook({ dataId: providerId, userId: sellerOne });
    expect(downgrade.body.data.outcome).toBe("stale");
    expect((await row(paymentId)).status).toBe("approved");
    fake.gateway.simulate(providerId, { status: "approved" });
  });

  it("keeps businesses apart: a notification re-addressed to another seller finds nothing", async () => {
    const target = await intent(1, cerveza, 1);
    const pending = await sandbox(target, "pending");
    const paymentId = pending.body.data.payment.paymentId as string;
    const providerId = (await row(paymentId)).provider_payment_id;
    fake.gateway.simulate(providerId, { status: "approved" });

    const elsewhere = await webhook({ dataId: providerId, userId: sellerTwo });
    expect(elsewhere.body.data.outcome).toBe("ignored");
    const unknown = await webhook({ dataId: providerId, userId: "999" });
    expect(unknown.body.data.outcome).toBe("unknown_seller");
    expect((await row(paymentId)).status).toBe("pending");
    expect(await ordersOf(target.intentId)).toBe(0);

    // The other business' diner endpoints cannot see or pay this intent either.
    const crossStart = await diner(two.host, "", target);
    expect(crossStart.status).toBe(404);
    const crossPay = await diner(two.host, "/pay", {
      ...target,
      method: { kind: "sandbox", outcome: "approved" }
    });
    expect(crossPay.status).toBe(404);
    const crossStatus = await diner(two.host, "/status", target);
    expect(crossStatus.status).toBe(404);
    const wrongToken = await diner(one.host, "/status", {
      intentId: target.intentId,
      token: await tokenOf(2)
    });
    expect(wrongToken.status).toBe(404);

    expect(
      (await webhook({ dataId: providerId, userId: sellerOne })).body.data
        .outcome
    ).toBe("applied");
  });

  it("returns the money when an accredited order can no longer be served", async () => {
    const target = await intent(2, cerveza, 2);
    await admin`
      update private.product_operational_stock set available_quantity = 0
      where tenant_id = ${one.tenantId} and product_id = ${cerveza}
    `;
    const paid = await sandbox(target, "approved");
    const paymentId = paid.body.data.payment.paymentId as string;
    expect(paid.body.data.payment).toMatchObject({
      fulfillment: "closed",
      refundedCents: 8_000,
      status: "approved"
    });
    expect(await ordersOf(target.intentId)).toBe(0);
    const stored = await row(paymentId);
    expect(stored).toMatchObject({
      fulfillment: "closed",
      order_id: null,
      refunded_cents: 8_000
    });
    await admin`
      update private.product_operational_stock set available_quantity = 50
      where tenant_id = ${one.tenantId} and product_id = ${cerveza}
    `;
  });

  it("refunds an online payment partially, only a manager, and only once per command", async () => {
    const target = await intent(3, milanesa, 1);
    const paid = await sandbox(target, "approved");
    const paymentId = paid.body.data.payment.paymentId as string;
    const payment = await row(paymentId);
    // Only a credit can be returned: the manager cancels the dish after the payment.
    await admin`
      select private.cancel_order_item(
        ${one.tenantId}::uuid, ${locationOne}::uuid, ${managerId}::uuid, ${next()}::uuid,
        ${payment.order_id}::uuid,
        (select line_id from private.confirmed_order_items where order_id = ${payment.order_id} limit 1),
        'Sin stock'
      )
    `;
    expect(await pendingOf(payment.session_id!)).toBe(-12_500);

    const refund = (token: string, body: Record<string, unknown>) =>
      app!
        .getHttpAdapter()
        .getInstance()
        .inject({
          headers: { authorization: `Bearer ${token}` },
          method: "POST",
          payload: { paymentId, reason: "Se terminó", ...body } as object,
          url: `/v1/staff/accounts/${payment.session_id}/online-refunds`
        });
    const command = next();
    expect(
      (await refund(waiterToken, { amountCents: 100, commandId: next() }))
        .statusCode
    ).toBe(403);
    const first = await refund(managerToken, {
      amountCents: 4_000,
      commandId: command
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().data).toEqual({ paymentId, refundedCents: 4_000 });
    // The same command again returns the same state; nothing is refunded twice.
    const again = await refund(managerToken, {
      amountCents: 4_000,
      commandId: command
    });
    expect(again.statusCode).toBe(200);
    expect(again.json().data).toEqual({ paymentId, refundedCents: 4_000 });
    expect((await row(paymentId)).refunded_cents).toBe(4_000);
    const second = await refund(managerToken, {
      amountCents: 3_000,
      commandId: next()
    });
    expect(second.json().data.refundedCents).toBe(7_000);
    const tooMuch = await refund(managerToken, {
      amountCents: 5_501,
      commandId: next()
    });
    expect(tooMuch.statusCode).toBe(409);
    expect(tooMuch.json().error.code).toBe("REFUND_EXCEEDS_LIMIT");
    const [refunds] = await admin<{ sum: number; count: number }[]>`
      select coalesce(sum(amount_cents), 0)::int as sum, count(*)::int as count
      from private.account_entries where kind = 'refund' and refund_of_source_id = ${paymentId}
    `;
    expect(refunds).toEqual({ count: 2, sum: 7_000 });
    expect(await pendingOf(payment.session_id!)).toBe(-12_500 + 7_000);

    // A refund made from the provider's own panel is recorded too, by its increase.
    fake.gateway.simulate(payment.provider_payment_id, {
      refundedCents: 9_000,
      status: "approved"
    });
    const outside = await webhook({
      dataId: payment.provider_payment_id,
      userId: sellerOne
    });
    expect(outside.body.data.outcome).toBe("applied");
    expect((await row(paymentId)).refunded_cents).toBe(9_000);

    // An in-person refund cannot return an online payment.
    await admin`
      select private.open_cash_shift(${one.tenantId}::uuid, ${locationOne}::uuid, ${managerId}::uuid, ${next()}::uuid, 0)
    `;
    const inPerson = await app!
      .getHttpAdapter()
      .getInstance()
      .inject({
        headers: { authorization: `Bearer ${managerToken}` },
        method: "POST",
        payload: {
          amountCents: 100,
          commandId: next(),
          itemLineId: null,
          paymentId,
          reason: "Prueba"
        },
        url: `/v1/staff/accounts/${payment.session_id}/refunds`
      });
    expect(inPerson.statusCode).toBe(409);
    expect(inPerson.json().error.code).toBe("ONLINE_PAYMENT_REFUND_ONLINE");
  });

  it("pays a reserved share online, once, and keeps the rest of the account apart", async () => {
    const lines = [milanesa, cerveza].map((productId) => ({
      lineId: next(),
      productId,
      quantity: 1,
      variantId: null
    }));
    await admin`
      select private.create_manual_order(
        ${one.tenantId}::uuid, ${locationOne}::uuid, ${managerId}::uuid, ${next()}::uuid,
        ${tableId(5)}::uuid, 'table', null, null, ${admin.json(lines)}
      )`;
    const [session] = await admin<{ id: string }[]>`
      select id from private.table_sessions
      where tenant_id = ${one.tenantId} and scope_key = ${tableId(5)} and status = 'open'`;
    await admin`
      select private.create_account_split(
        ${one.tenantId}::uuid, ${locationOne}::uuid, ${managerId}::uuid, ${next()}::uuid,
        ${session!.id}::uuid, 2
      )`;
    const token = await tokenOf(5);
    const phone = "P".repeat(43);
    const other = "Q".repeat(43);
    const split = (path: string, body: object, host = one.host) =>
      app!
        .getHttpAdapter()
        .getInstance()
        .inject({
          headers: { host },
          method: "POST",
          payload: body as object,
          url: `/v1/public/account-splits/${path}`
        });
    const claim = await split("claim", {
      label: "Ana",
      position: 1,
      secret: phone,
      token
    });
    expect(claim.statusCode).toBe(200);

    const share = (path: string, body: object, host = one.host) =>
      app!
        .getHttpAdapter()
        .getInstance()
        .inject({
          headers: { host },
          method: "POST",
          payload: body as object,
          url: `/v1/public/online-payments/share/${path}`
        });
    const target = { position: 1, secret: phone, token };
    // Only the phone that reserved it can start or pay; others and other businesses cannot.
    expect(
      (await share("start", { ...target, secret: other })).statusCode
    ).toBe(409);
    expect((await share("start", target, two.host)).statusCode).toBe(404);
    expect((await share("start", { ...target, position: 2 })).statusCode).toBe(
      409
    );
    const started = await share("start", target);
    expect(started.statusCode).toBe(200);
    expect(started.json().data).toMatchObject({
      mode: "sandbox",
      payment: { amountCents: 8_250, status: "created" }
    });

    const method = (outcome: string) => ({ kind: "sandbox", outcome });
    const rejected = await share("pay", {
      ...target,
      method: method("rejected")
    });
    expect(rejected.json().data).toMatchObject({
      payment: { status: "rejected" },
      shareStatus: "claimed"
    });
    expect(await pendingOf(session!.id)).toBe(16_500);

    const pending = await share("pay", {
      ...target,
      method: method("pending")
    });
    expect(pending.json().data).toMatchObject({
      payment: { status: "pending" },
      shareStatus: "claimed"
    });
    const paymentId = pending.json().data.payment.paymentId as string;
    const providerId = (await row(paymentId)).provider_payment_id;
    fake.gateway.simulate(providerId, { status: "approved" });
    expect(
      (await webhook({ dataId: providerId, userId: sellerOne })).body.data
        .outcome
    ).toBe("applied");
    const paid = await share("status", target);
    expect(paid.json().data).toMatchObject({
      payment: { fulfillment: "confirmed", status: "approved" },
      shareStatus: "paid"
    });
    expect(await pendingOf(session!.id)).toBe(8_250);
    const [entry] = await admin<
      {
        actor_type: string;
        payment_method: string;
        shift_id: string | null;
        amount_cents: number;
      }[]
    >`
      select actor_type, payment_method, shift_id, amount_cents from private.account_entries
      where source_id = ${paymentId} and kind = 'payment'`;
    expect(entry).toEqual({
      actor_type: "system",
      amount_cents: -8_250,
      payment_method: "mercado_pago",
      shift_id: null
    });

    // Paying it again does not charge twice, and a replayed notification is a duplicate.
    await share("pay", { ...target, method: method("approved") });
    const [attempts] = await admin<{ count: number }[]>`
      select count(*)::int as count from private.online_payments where status = 'approved' and share_split_id is not null
        and tenant_id = ${one.tenantId}`;
    expect(attempts!.count).toBe(1);
    expect(await pendingOf(session!.id)).toBe(8_250);

    // The staff can still return part of it from the provider, like any online payment.
    const [shareRow] = await admin<{ split_id: string }[]>`
      select share_split_id as split_id from private.online_payments where id = ${paymentId}`;
    expect(shareRow!.split_id).toBeTruthy();
    expect(
      (
        await share("pay", {
          ...target,
          method: { kind: "card", card: { number: "4111111111111111" } }
        })
      ).statusCode
    ).toBe(400);
  });

  it("rejects malformed or forged payment requests before touching the provider", async () => {
    const target = await intent(4, milanesa, 1);
    for (const body of [
      {},
      { ...target, tenantId: one.tenantId },
      { intentId: "x", token: target.token },
      { ...target, token: "A".repeat(64) }
    ]) {
      expect((await diner(one.host, "", body)).status).toBe(400);
      expect((await diner(one.host, "/status", body)).status).toBe(400);
    }
    for (const method of [
      { kind: "sandbox", outcome: "refunded" },
      { kind: "card", card: { number: "4111111111111111" } },
      { kind: "sandbox", outcome: "approved", amountCents: 1 }
    ]) {
      expect(
        (await diner(one.host, "/pay", { ...target, method })).status
      ).toBe(400);
    }
    expect(await ordersOf(target.intentId)).toBe(0);
    const anonymous = await app!
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "POST",
        payload: {
          amountCents: 1,
          commandId: next(),
          paymentId: next(),
          reason: "x"
        },
        url: `/v1/staff/accounts/${next()}/online-refunds`
      });
    expect(anonymous.statusCode).toBe(401);
  });

  it("controls the sandbox only with the shared secret", async () => {
    const anonymous = await app!
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "POST",
        payload: { status: "approved" },
        url: "/v1/dev/mercado-pago/payments/5550001"
      });
    expect(anonymous.statusCode).toBe(401);
    const wrong = await app!
      .getHttpAdapter()
      .getInstance()
      .inject({
        headers: { authorization: "Bearer nope" },
        method: "POST",
        payload: { status: "approved" },
        url: "/v1/dev/mercado-pago/payments/5550001"
      });
    expect(wrong.statusCode).toBe(401);
    const invalid = await app!
      .getHttpAdapter()
      .getInstance()
      .inject({
        headers: { authorization: `Bearer ${fake.secret}` },
        method: "POST",
        payload: { status: "exploded" },
        url: "/v1/dev/mercado-pago/payments/5550001"
      });
    expect(invalid.statusCode).toBe(400);
  });
});
