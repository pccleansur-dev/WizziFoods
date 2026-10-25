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
  slug: "regroup-it-1",
  tenantId: "32000000-0000-4000-8000-000000000013",
  userId: "32000000-0000-4000-8000-000000000011"
};
const two: Fixture = {
  slug: "regroup-it-2",
  tenantId: "32000000-0000-4000-8000-000000000023",
  userId: "32000000-0000-4000-8000-000000000021"
};

const level = "32100000-0000-4000-8000-0000000000f1";
const sectorSalon = "32100000-0000-4000-8000-000000000001";
const categoryId = "32300000-0000-4000-8000-000000000003";
const kitchenSector = "32300000-0000-4000-8000-000000000002";
const barSector = "32300000-0000-4000-8000-000000000004";
const milanesa = "32300000-0000-4000-8000-000000000001";
const cerveza = "32300000-0000-4000-8000-000000000005";
const prices: Record<string, number> = { [cerveza]: 4_000, [milanesa]: 12_500 };
const tableCount = 40;
const tableId = (n: number) =>
  `32200000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function uuid(seed: number): string {
  return `ff320000-0000-4000-8000-${String(seed).padStart(12, "0")}`;
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

describeWithLocalStack(
  "joining and separating tables with local Supabase",
  () => {
    const admin = postgres(databaseAdminUrl ?? "", { prepare: false });
    let app: NestFastifyApplication | undefined;
    let locationOne = "";
    let locationTwo = "";
    const sessions = new Map<string, string>();
    const staffIds = new Map<string, string>();
    const tokens = new Map<number, string>();
    let counter = 1_000;
    const next = () => uuid(counter++);

    // Triggers stay enabled for everyone else: other integration files assert the
    // append-only guards at the same time, so only this transaction skips them.
    async function cleanup() {
      for (const fixture of [one, two]) {
        const tenant = fixture.tenantId;
        await admin.begin(async (tx) => {
          await tx`set local session_replication_role = replica`;
          await tx`delete from private.table_group_events where tenant_id = ${tenant}`;
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
      const response = await app!
        .getHttpAdapter()
        .getInstance()
        .inject(options);
      return { body: response.json(), status: response.statusCode };
    }

    async function enter(token: string) {
      const response = await app!
        .getHttpAdapter()
        .getInstance()
        .inject({
          headers: { host: `${one.slug}.plataforma.test` },
          method: "POST",
          payload: { token },
          url: "/v1/public/table-entry"
        });
      return response.json().data.entry as {
        group: { name: string; tableLabels: string[] } | null;
        mode: string;
      };
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
      return row!.result.orderId;
    }

    async function openSessions(): Promise<
      {
        group_id: string | null;
        id: string;
        scope_key: string;
        table_id: string;
      }[]
    > {
      return admin`
      select id, scope_key, table_id, group_id from private.table_sessions
      where tenant_id = ${one.tenantId} and status = 'open'
    `;
    }

    async function sessionCovering(table: number): Promise<string | undefined> {
      const [row] = await admin<{ id: string }[]>`
      select account_session.id from private.table_sessions account_session
      where account_session.tenant_id = ${one.tenantId}
        and account_session.status = 'open'
        and account_session.scope_key = coalesce((
          select member.group_id from private.floor_group_members member
          where member.tenant_id = ${one.tenantId}
            and member.table_id = ${tableId(table)}::uuid), ${tableId(table)}::uuid)
    `;
      return row?.id;
    }

    async function groupOf(table: number): Promise<string | undefined> {
      const [row] = await admin<{ group_id: string }[]>`
      select group_id from private.floor_group_members
      where tenant_id = ${one.tenantId} and table_id = ${tableId(table)}::uuid
    `;
      return row?.group_id;
    }

    /** Sessions whose scope disagrees with the groups: must always be zero. */
    async function inconsistentSessions(): Promise<number> {
      const [row] = await admin<{ total: number }[]>`
      select count(*)::int as total
      from private.table_sessions s
      where s.tenant_id = ${one.tenantId}
        and s.status = 'open'
        and (
          (s.group_id is null and (
            s.scope_key <> s.table_id
            or exists (
              select 1 from private.floor_group_members m
              where m.tenant_id = s.tenant_id and m.table_id = s.table_id)))
          or (s.group_id is not null and (
            s.scope_key <> s.group_id
            or not exists (
              select 1 from private.floor_group_members m
              where m.tenant_id = s.tenant_id and m.group_id = s.group_id
                and m.table_id = s.table_id))))
    `;
      return row!.total;
    }

    async function ledger(): Promise<string> {
      const [row] = await admin<{ snapshot: string }[]>`
      select count(*)::text || ':' || coalesce(sum(amount_cents), 0)::text as snapshot
      from private.account_entries where tenant_id = ${one.tenantId}
    `;
      return row!.snapshot;
    }

    async function orderTables(): Promise<string> {
      const [row] = await admin<{ snapshot: string }[]>`
      select coalesce(string_agg(
        id::text || table_id::text || coalesce(session_id::text, '-'), ',' order by id
      ), '') as snapshot
      from private.confirmed_orders where tenant_id = ${one.tenantId}
    `;
      return row!.snapshot;
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

    async function groupCount(): Promise<number> {
      const [row] = await admin<{ total: number }[]>`
      select count(*)::int as total from private.floor_groups
      where tenant_id = ${one.tenantId}
    `;
      return row!.total;
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
      staff(user, "POST", `/v1/staff/accounts/${sessionId}/close`, {
        commandId
      });
    const clean = (user: string, table: number, commandId = next()) =>
      staff(user, "POST", `/v1/staff/tables/${tableId(table)}/clean`, {
        commandId
      });
    const join = (
      user: string,
      tableNumbers: number[],
      name?: string,
      commandId = next()
    ) =>
      staff(user, "POST", "/v1/staff/table-groups", {
        commandId,
        ...(name === undefined ? {} : { name }),
        tableIds: tableNumbers.map(tableId)
      });
    const separate = (
      user: string,
      groupId: string,
      anchor: number | null,
      commandId = next()
    ) =>
      staff(user, "POST", `/v1/staff/table-groups/${groupId}/separate`, {
        commandId,
        ...(anchor === null ? {} : { anchorTableId: tableId(anchor) })
      });

    beforeAll(async () => {
      await cleanup();
      for (const fixture of [one, two]) {
        await admin`insert into auth.users (id) values (${fixture.userId})`;
        await admin`
        insert into public.tenants (id, slug, name, status)
        values (${fixture.tenantId}, ${fixture.slug}, 'Regroup IT', 'active')
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
          tables: [{ ...tables[0], id: "32200000-0000-4000-8000-0000000000ff" }]
        })}
      )
    `;
      const qr = await admin<{ label: string; token: string }[]>`
      select floor_table.label, code.token
      from private.floor_tables floor_table
      join private.floor_table_qr_codes code
        on code.tenant_id = floor_table.tenant_id
        and code.table_id = floor_table.id and code.status = 'active'
      where floor_table.tenant_id = ${one.tenantId}
    `;
      for (const row of qr) tokens.set(Number(row.label), row.token);
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
      for (const name of ["ana", "luis", "marta", "coco"])
        await login(one, name);
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

    it("joins, consumes, pays part and separates: every QR follows, nothing is moved", async () => {
      // Joining two loose tables opens no account, but both QR codes know the group.
      const joined = await join("ana", [1, 2], "Cumple");
      expect(joined.status).toBe(200);
      expect(joined.body.data).toMatchObject({
        name: "Cumple",
        sessionId: null
      });
      const groupId = joined.body.data.groupId as string;
      for (const table of [1, 2]) {
        expect(await enter(tokens.get(table)!)).toMatchObject({
          group: { name: "Cumple", tableLabels: ["1", "2"] },
          mode: "start"
        });
      }

      // One order on table 1 opens ONE account for the group, seen from table 2 too.
      await place(1, [milanesa, cerveza]);
      const sessionId = (await sessionCovering(2))!;
      expect(sessionId).toBe(await sessionCovering(1));
      expect((await enter(tokens.get(2)!)).mode).toBe("join");
      expect(
        (await pay("ana", sessionId, { amountCents: 10_000 })).status
      ).toBe(200);

      // A third table joins the open account: its QR recognises the group at once.
      const more = await join("ana", [3, 1]);
      expect(more.status).toBe(200);
      expect(more.body.data).toMatchObject({
        groupId,
        name: "Cumple",
        sessionId
      });
      expect(await enter(tokens.get(3)!)).toMatchObject({
        group: { name: "Cumple", tableLabels: ["1", "2", "3"] },
        mode: "join"
      });
      expect(await stateOf(3)).toBe("occupied");

      const before = { ledger: await ledger(), orders: await orderTables() };
      const refused = await separate("ana", groupId, null);
      expect(refused.status).toBe(409);
      expect(refused.body.error.code).toBe("ANCHOR_TABLE_REQUIRED");

      const separated = await separate("ana", groupId, 2);
      expect(separated.status).toBe(200);
      expect(separated.body.data).toMatchObject({
        anchorTableId: tableId(2),
        releasedTableIds: [tableId(1), tableId(3)],
        sessionId
      });
      // Orders, payments and debt stay exactly where they were.
      expect({ ledger: await ledger(), orders: await orderTables() }).toEqual(
        before
      );
      expect(await pendingOf(sessionId)).toBe(6_500);
      expect(await inconsistentSessions()).toBe(0);

      // The QR codes follow the new situation.
      expect(await enter(tokens.get(2)!)).toMatchObject({
        group: null,
        mode: "join"
      });
      expect(await enter(tokens.get(1)!)).toMatchObject({
        group: null,
        mode: "start"
      });
      expect(await sessionCovering(2)).toBe(sessionId);
      expect(await sessionCovering(1)).toBeUndefined();

      // The rest is paid on the anchor; closing leaves only the anchor to clean.
      expect((await pay("ana", sessionId)).status).toBe(200);
      expect((await close("ana", sessionId)).status).toBe(200);
      expect(await stateOf(2)).toBe("needs_cleaning");
      expect(await stateOf(1)).toBe("available");
      expect(await stateOf(3)).toBe("available");

      // A released table starts a new, independent account.
      await place(1, [cerveza]);
      const fresh = await sessionCovering(1);
      expect(fresh).toBeDefined();
      expect(fresh).not.toBe(sessionId);
      expect((await clean("ana", 2)).status).toBe(200);
    });

    it("keeps the history of every change and audits it", async () => {
      const [events] = await admin<{ total: number; separated: number }[]>`
      select count(*)::int as total,
        count(*) filter (where kind = 'separated')::int as separated
      from private.table_group_events where tenant_id = ${one.tenantId}`;
      expect(events!.total).toBeGreaterThanOrEqual(3);
      expect(events!.separated).toBeGreaterThanOrEqual(1);
      const [audit] = await admin<{ total: number }[]>`
      select count(*)::int as total from private.audit_events
      where tenant_id = ${one.tenantId}
        and action in ('table_group.joined', 'table_group.separated')`;
      expect(audit!.total).toBe(events!.total);
    });

    it("refuses a join that would mix two open accounts, and tells why", async () => {
      await place(10, [milanesa]);
      await place(11, [cerveza]);
      const first = await sessionCovering(10);
      const second = await sessionCovering(11);
      expect(first).not.toBe(second);
      const mixed = await join("marta", [10, 11]);
      expect(mixed.status).toBe(409);
      expect(mixed.body.error.code).toBe("DIFFERENT_OPEN_ACCOUNTS");
      expect(await groupOf(10)).toBeUndefined();
      expect(await sessionCovering(10)).toBe(first);
      expect(await sessionCovering(11)).toBe(second);

      // Once one account closes, the other table can be joined to a free one.
      expect((await pay("ana", first!)).status).toBe(200);
      expect((await close("ana", first!)).status).toBe(200);
      expect((await clean("ana", 10)).status).toBe(200);
      expect((await join("ana", [10, 11])).status).toBe(200);
      expect(await sessionCovering(10)).toBe(second);
      expect(await inconsistentSessions()).toBe(0);
    });

    it("checks who may join or separate, and in which business", async () => {
      expect((await join("coco", [20, 21])).status).toBe(403);
      expect((await join("luis", [20, 21])).status).toBe(404);
      expect((await join("otra", [20, 21])).status).toBe(404);
      expect((await join("ana", [20])).status).toBe(400);
      expect((await join("ana", [20, 20])).status).toBe(400);
      const extra = await staff("ana", "POST", "/v1/staff/table-groups", {
        commandId: next(),
        tableIds: [tableId(20), tableId(21)],
        tenantId: one.tenantId
      });
      expect(extra.status).toBe(400);
      expect(await groupOf(20)).toBeUndefined();

      const created = await join("ana", [20, 21]);
      expect(created.status).toBe(200);
      const groupId = created.body.data.groupId as string;
      expect((await separate("coco", groupId, null)).status).toBe(403);
      expect((await separate("luis", groupId, null)).status).toBe(404);
      expect((await separate("otra", groupId, null)).status).toBe(404);
      expect((await separate("ana", "not-a-uuid", null)).status).toBe(400);
      expect((await separate("ana", groupId, 30)).status).toBe(409);
      expect((await separate("ana", groupId, null)).status).toBe(200);
    });

    it("creates exactly one group when eight joins race, and replays a repeated command", async () => {
      const racing = await Promise.all(
        Array.from({ length: 8 }, () => join("ana", [22, 23]))
      );
      expect(racing.filter((r) => r.status === 200)).toHaveLength(1);
      expect(
        new Set(
          racing
            .filter((r) => r.status !== 200)
            .map((r) => r.body.error.code as string)
        )
      ).toEqual(new Set(["TABLES_CANNOT_BE_JOINED"]));
      const groupId = (await groupOf(22))!;
      expect(await groupOf(23)).toBe(groupId);

      const command = next();
      const replay = await Promise.all(
        Array.from({ length: 6 }, () =>
          join("ana", [24, 25], undefined, command)
        )
      );
      expect(replay.every((r) => r.status === 200)).toBe(true);
      expect(new Set(replay.map((r) => JSON.stringify(r.body.data))).size).toBe(
        1
      );
      expect(await groupOf(24)).toBeDefined();

      // Several separations at once: only one wins, the rest find no group.
      const apart = await Promise.all(
        Array.from({ length: 6 }, () => separate("ana", groupId, null))
      );
      expect(apart.filter((r) => r.status === 200)).toHaveLength(1);
      expect(
        new Set(
          apart
            .filter((r) => r.status !== 200)
            .map((r) => r.body.error.code as string)
        )
      ).toEqual(new Set(["TABLE_GROUP_NOT_FOUND"]));
      expect(await groupOf(22)).toBeUndefined();
      const second = (await groupOf(24))!;
      expect((await separate("ana", second, null)).status).toBe(200);
    });

    it("never leaves an order on a stale scope when joining races with ordering", async () => {
      for (let round = 0; round < 6; round += 1) {
        const a = 26 + round * 2;
        const b = a + 1;
        const outcome = await Promise.allSettled([
          join("ana", [a, b]),
          place(a, [cerveza]),
          place(b, [cerveza])
        ]);
        expect(outcome[0].status).toBe("fulfilled");
        const attempt = (
          outcome[0] as PromiseFulfilledResult<{
            body: { error?: { code: string } };
            status: number;
          }>
        ).value;
        // Whatever the interleaving: scopes agree with the groups...
        expect(await inconsistentSessions()).toBe(0);
        const group = await groupOf(a);
        if (attempt.status === 200) {
          expect(group).toBeDefined();
          // ...and a joined pair never has two accounts.
          const covering = await sessionCovering(a);
          expect(covering).toBe(await sessionCovering(b));
        } else {
          // The join lost to two orders that had already opened two accounts.
          expect(attempt.body.error?.code).toBe("DIFFERENT_OPEN_ACCOUNTS");
          expect(group).toBeUndefined();
          expect(await sessionCovering(a)).not.toBe(await sessionCovering(b));
        }
      }
    });

    it("keeps the balance right when a payment races with joining and separating", async () => {
      await place(38, [milanesa]);
      const sessionId = (await sessionCovering(38))!;
      const spent = await ledger();
      const outcome = await Promise.all([
        join("ana", [38, 39]),
        pay("ana", sessionId, { amountCents: 5_000 }),
        join("marta", [38, 39])
      ]);
      expect(outcome[1].status).toBe(200);
      expect(
        outcome.filter((r) => r.status === 200).length
      ).toBeGreaterThanOrEqual(2);
      expect(await pendingOf(sessionId)).toBe(7_500);
      expect(await inconsistentSessions()).toBe(0);
      const group = (await groupOf(38))!;
      const apart = await Promise.all([
        separate("ana", group, 39),
        pay("marta", sessionId, { amountCents: 2_500 })
      ]);
      expect(apart[1].status).toBe(200);
      expect(apart[0].status).toBe(200);
      expect(await pendingOf(sessionId)).toBe(5_000);
      expect(await inconsistentSessions()).toBe(0);
      expect(await ledger()).not.toBe(spent);
      expect(await sessionCovering(39)).toBe(sessionId);
    });

    it("joins or closes first, never both halves: a close racing a join stays coherent", async () => {
      for (let round = 0; round < 4; round += 1) {
        const a = 30 + round * 2;
        const b = a + 1;
        await place(a, [cerveza]);
        const sessionId = (await sessionCovering(a))!;
        expect((await pay("ana", sessionId)).status).toBe(200);
        const outcome = await Promise.all([
          close("ana", sessionId),
          join("ana", [a, b])
        ]);
        expect(outcome[0].status).toBe(200);
        expect(await inconsistentSessions()).toBe(0);
        const [closed] = await admin<{ status: string }[]>`
        select status from private.table_sessions where id = ${sessionId}`;
        expect(closed!.status).toBe("closed");
        expect(await pendingOf(sessionId)).toBe(0);
        // Closing cleaned the tables the session covered when it closed.
        expect(await stateOf(a)).toBe("needs_cleaning");
        if (outcome[1].status === 200) {
          expect(await groupOf(a)).toBeDefined();
        }
      }
    });

    it("keeps the groups consistent after everything", async () => {
      expect(await inconsistentSessions()).toBe(0);
      expect(await groupCount()).toBeGreaterThanOrEqual(0);
      const open = await openSessions();
      const scopes = open.map((row) => row.scope_key);
      expect(new Set(scopes).size).toBe(scopes.length);
    });
  }
);
