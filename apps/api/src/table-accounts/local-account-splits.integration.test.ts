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
  slug: "split-it-1",
  tenantId: "30000000-0000-4000-8000-000000000013",
  userId: "30000000-0000-4000-8000-000000000011"
};
const two: Fixture = {
  slug: "split-it-2",
  tenantId: "30000000-0000-4000-8000-000000000023",
  userId: "30000000-0000-4000-8000-000000000021"
};

const level = "30100000-0000-4000-8000-0000000000f1";
const sectorSalon = "30100000-0000-4000-8000-000000000001";
const categoryId = "30300000-0000-4000-8000-000000000003";
const kitchenSector = "30300000-0000-4000-8000-000000000002";
const barSector = "30300000-0000-4000-8000-000000000004";
const milanesa = "30300000-0000-4000-8000-000000000001";
const cerveza = "30300000-0000-4000-8000-000000000005";
const prices: Record<string, number> = { [cerveza]: 4_000, [milanesa]: 12_500 };
const tableCount = 20;
const tableId = (n: number) =>
  `30200000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function uuid(seed: number): string {
  return `ff300000-0000-4000-8000-${String(seed).padStart(12, "0")}`;
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

describeWithLocalStack("account splits with local Supabase", () => {
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

  const open = (user: string, openingCashCents: number, commandId = next()) =>
    staff(user, "POST", "/v1/staff/cash-register/open", {
      commandId,
      openingCashCents
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
          tables: [{ ...tables[0], id: "30200000-0000-4000-8000-0000000000ff" }]
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
    for (const name of ["ana", "marta", "coco"]) await login(one, name);
    await login(two, "otra");
  }, 90_000);

  afterAll(async () => {
    await app?.close();
    await cleanup();
    await admin.end();
  });

  const split = (
    user: string,
    sessionId: string,
    parts: number,
    commandId = next()
  ) =>
    staff(user, "POST", `/v1/staff/accounts/${sessionId}/splits`, {
      commandId,
      parts
    });
  const payShares = (
    user: string,
    sessionId: string,
    splitId: string,
    positions: number[],
    extra: Record<string, unknown> = {},
    commandId = next()
  ) =>
    staff(user, "POST", `/v1/staff/accounts/${sessionId}/split-payments`, {
      commandId,
      method: "cash",
      payerLabel: null,
      positions,
      splitId,
      tipCents: 0,
      ...extra
    });

  it("splits three ways, lets one payer take two shares, and keeps later consumption apart", async () => {
    expect((await open("marta", 0)).status).toBe(200);
    await place(1, [milanesa, cerveza]);
    const sessionId = await sessionOf(1);
    expect((await split("coco", sessionId, 3)).status).toBe(403);
    expect((await split("ana", sessionId, 1)).status).toBe(400);
    const made = await split("ana", sessionId, 3);
    expect(made.status).toBe(200);
    const splitId = made.body.data.split.splitId as string;
    expect(
      made.body.data.split.shares.map(
        (s: { amountCents: number }) => s.amountCents
      )
    ).toEqual([5_500, 5_500, 5_500]);

    const both = await payShares("ana", sessionId, splitId, [1, 2], {
      payerLabel: "Ana"
    });
    expect(both.status).toBe(200);
    expect(both.body.data).toMatchObject({
      amountCents: 11_000,
      pendingCents: 5_500
    });

    // A later order is new balance, outside the remaining share.
    await place(1, [cerveza]);
    expect(await pendingOf(sessionId)).toBe(9_500);
    const taken = await payShares("ana", sessionId, splitId, [2]);
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe("SPLIT_SHARE_UNAVAILABLE");
    const last = await payShares("ana", sessionId, splitId, [3], {
      method: "debit_card",
      payerLabel: "Beto"
    });
    expect(last.body.data.pendingCents).toBe(4_000);
    expect(last.body.data.split).toBeNull();
    const view = await staff("ana", "GET", "/v1/staff/accounts");
    expect(view.body.data.accounts[0].split).toBeNull();
  });

  it("never lets simultaneous payments take the same share or exceed the pending balance", async () => {
    await place(2, [milanesa, cerveza]);
    const sessionId = await sessionOf(2);
    const splitId = (await split("ana", sessionId, 3)).body.data.split
      .splitId as string;
    // Six devices race for the same share with different commands.
    const sameShare = await Promise.all(
      Array.from({ length: 6 }, () => payShares("ana", sessionId, splitId, [1]))
    );
    expect(sameShare.filter((r) => r.status === 200)).toHaveLength(1);
    expect(sameShare.filter((r) => r.status === 409)).toHaveLength(5);

    // Overlapping claims: exactly one of them wins the shared share, never both.
    const overlap = await Promise.all([
      payShares("ana", sessionId, splitId, [2, 3]),
      payShares("marta", sessionId, splitId, [3]),
      payShares("ana", sessionId, splitId, [2])
    ]);
    const paid = await admin<{ position: number }[]>`
      select position from private.account_split_shares
      where split_id = ${splitId} and status = 'paid' order by position`;
    expect(paid.map((p) => p.position).sort()).toEqual([1, 2, 3]);
    expect(
      overlap.filter((r) => r.status === 200).length
    ).toBeGreaterThanOrEqual(1);
    expect(await pendingOf(sessionId)).toBe(0);
    const [payments] = await admin<{ total: number }[]>`
      select coalesce(-sum(amount_cents), 0)::int as total from private.account_entries
      where session_id = ${sessionId} and kind = 'payment'`;
    expect(payments!.total).toBe(16_500);
  });

  it("refuses shares that no longer fit the balance and replays a retried command", async () => {
    await place(3, [milanesa, cerveza]);
    const sessionId = await sessionOf(3);
    const splitId = (await split("ana", sessionId, 2)).body.data.split
      .splitId as string;
    // The manager pays most of the account by hand: a share of 8250 no longer fits.
    expect(
      (await pay("marta", sessionId, { amountCents: 10_000 })).status
    ).toBe(200);
    const stale = await payShares("ana", sessionId, splitId, [1]);
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("PAYMENT_EXCEEDS_PENDING");
    // A failed claim leaves the share open; a new split is computed on the current balance.
    const again = await split("ana", sessionId, 2);
    expect(
      again.body.data.split.shares.map(
        (s: { amountCents: number }) => s.amountCents
      )
    ).toEqual([3_250, 3_250]);
    const command = next();
    const first = await payShares(
      "ana",
      sessionId,
      again.body.data.split.splitId,
      [1],
      {},
      command
    );
    const retry = await payShares(
      "ana",
      sessionId,
      again.body.data.split.splitId,
      [1],
      {},
      command
    );
    expect(retry.body).toEqual(first.body);
    const [count] = await admin<{ count: number }[]>`
      select count(*)::int as count from private.account_entries
      where session_id = ${sessionId} and kind = 'payment'`;
    expect(count!.count).toBe(2);
  });

  async function tokenOf(table: number) {
    const [row] = await admin<{ token: string }[]>`
      select token from private.floor_table_qr_codes
      where tenant_id = ${one.tenantId} and table_id = ${tableId(table)} and status = 'active'`;
    return row!.token;
  }
  const secretA = "A".repeat(43);
  const secretB = "B".repeat(43);
  const diner = async (
    path: string,
    payload: unknown,
    host = `${one.slug}.plataforma.test`
  ) => {
    const response = await app!
      .getHttpAdapter()
      .getInstance()
      .inject({
        headers: { host },
        method: "POST",
        payload: payload as object,
        url: `/v1/public/account-splits/${path}`
      });
    return { body: response.json(), status: response.statusCode };
  };

  it("splits by consumption and shows the items each person owns", async () => {
    await place(4, [milanesa, cerveza, cerveza]);
    const sessionId = await sessionOf(4);
    const view = await staff("ana", "GET", "/v1/staff/accounts");
    const account = view.body.data.accounts.find(
      (entry: { sessionId: string }) => entry.sessionId === sessionId
    );
    expect(account.liveItems).toHaveLength(3);
    const [dish, beer] = account.liveItems as {
      lineId: string;
      title: string;
    }[];
    expect(dish!.title).toBe("Milanesa");
    const made = await staff(
      "ana",
      "POST",
      `/v1/staff/accounts/${sessionId}/item-splits`,
      {
        assignments: [
          { lineId: dish!.lineId, position: 1 },
          { lineId: beer!.lineId, position: 2 }
        ],
        commandId: next(),
        persons: 2
      }
    );
    expect(made.status).toBe(200);
    expect(made.body.data.split).toMatchObject({ kind: "items" });
    expect(
      made.body.data.split.shares.map(
        (x: { amountCents: number }) => x.amountCents
      )
    ).toEqual([14_500, 6_000]);
    expect(made.body.data.split.shares[0].items).toEqual(["1 × Milanesa"]);
    // Bad assignments are refused before anything is stored.
    const bad = await staff(
      "ana",
      "POST",
      `/v1/staff/accounts/${sessionId}/item-splits`,
      {
        assignments: [{ lineId: next(), position: 1 }],
        commandId: next(),
        persons: 2
      }
    );
    expect(bad.status).toBe(400);
  });

  it("lets diners reserve shares from their phones, exactly once, and the waiter collects them", async () => {
    const token = await tokenOf(4);
    const sessionId = await sessionOf(4);
    const shown = await diner("view", { secret: secretA, token });
    expect(shown.body.data.split.kind).toBe("items");
    const first = await diner("claim", {
      label: "Beto",
      position: 2,
      secret: secretA,
      token
    });
    expect(first.body.data.split.shares[1]).toMatchObject({
      claimedBy: "Beto",
      mine: true,
      status: "claimed"
    });

    // Six phones race for the one remaining share: exactly one gets it.
    const race = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        diner("claim", {
          label: `Persona ${index}`,
          position: 1,
          secret: String(index).repeat(43),
          token
        })
      )
    );
    expect(race.filter((r) => r.status === 200)).toHaveLength(1);
    expect(race.filter((r) => r.status === 409)).toHaveLength(5);
    const taken = await diner("claim", {
      label: "Ana",
      position: 2,
      secret: secretB,
      token
    });
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe("SPLIT_SHARE_UNAVAILABLE");
    const stranger = await diner("release", {
      position: 2,
      secret: secretB,
      token
    });
    expect(stranger.status).toBe(409);
    const others = await diner("view", { secret: secretB, token });
    expect(others.body.data.split.shares[1]).toMatchObject({
      claimedBy: "Beto",
      mine: false
    });

    // Another business, an invented token or a forged body reach nothing.
    expect(
      (
        await diner(
          "claim",
          { label: "X", position: 1, secret: secretA, token },
          `${two.slug}.plataforma.test`
        )
      ).status
    ).toBe(404);
    expect(
      (await diner("view", { secret: secretA, token: "0".repeat(64) })).body
        .data.split
    ).toBeNull();
    expect(
      (
        await diner("claim", {
          label: "X",
          position: 1,
          secret: secretA,
          token,
          tenantId: two.tenantId
        })
      ).status
    ).toBe(400);

    // The waiter collects the share Beto reserved; he can no longer release it.
    const split = (
      await staff("ana", "GET", "/v1/staff/accounts")
    ).body.data.accounts.find(
      (entry: { sessionId: string }) => entry.sessionId === sessionId
    ).split;
    const paid = await payShares("ana", sessionId, split.splitId, [2]);
    expect(paid.status).toBe(200);
    expect(paid.body.data.amountCents).toBe(6_000);
    const afterPay = await diner("release", {
      position: 2,
      secret: secretA,
      token
    });
    expect(afterPay.status).toBe(409);
    const winner = race.find((r) => r.status === 200)!;
    const remaining = winner.body.data.split.shares[0];
    expect(remaining.status).toBe("claimed");
    expect((await payShares("ana", sessionId, split.splitId, [1])).status).toBe(
      200
    );
    expect(await pendingOf(sessionId)).toBe(0);
  });

  it("rejects forged bodies", async () => {
    const sessionId = await sessionOf(3);
    expect(
      (
        await staff(
          "ana",
          "POST",
          `/v1/staff/accounts/${sessionId}/split-payments`,
          {
            commandId: next(),
            positions: [1],
            splitId: next(),
            method: "cash",
            payerLabel: null,
            tipCents: 0,
            amountCents: 1
          }
        )
      ).status
    ).toBe(400);
    expect(
      (
        await staff("ana", "POST", `/v1/staff/accounts/${sessionId}/splits`, {
          commandId: next(),
          parts: 3,
          tenantId: two.tenantId
        })
      ).status
    ).toBe(400);
    const foreign = await staff(
      "otra",
      "POST",
      `/v1/staff/accounts/${sessionId}/splits`,
      { commandId: next(), parts: 2 }
    );
    expect([403, 404]).toContain(foreign.status);
  });
});
