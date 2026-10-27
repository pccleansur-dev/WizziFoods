import {
  FastifyAdapter,
  type NestFastifyApplication
} from "@nestjs/platform-fastify";
import { NestFactory } from "@nestjs/core";
import type { ApiRuntimeConfig } from "@platform/config";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../app.module.js";

const databaseUrl = process.env.DATABASE_URL;
const databaseAdminUrl = process.env.DATABASE_ADMIN_URL;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
const hasLocalStack =
  databaseUrl && databaseAdminUrl && supabaseUrl && supabaseSecretKey;
const describeWithLocalStack = hasLocalStack ? describe : describe.skip;

type Fixture = { hostname: string; tenantId: string; userId: string };

const one: Fixture = {
  hostname: "entry-one.plataforma.test",
  tenantId: "fd000000-0000-4000-8000-000000000013",
  userId: "fd000000-0000-4000-8000-000000000011"
};
const two: Fixture = {
  hostname: "entry-two.plataforma.test",
  tenantId: "fd000000-0000-4000-8000-000000000023",
  userId: "fd000000-0000-4000-8000-000000000021"
};

const level = "fd100000-0000-4000-8000-0000000000f1";
const sector = "fd100000-0000-4000-8000-000000000001";
const free = "fd200000-0000-4000-8000-000000000001";
const mateA = "fd200000-0000-4000-8000-000000000002";
const mateB = "fd200000-0000-4000-8000-000000000003";
const dirty = "fd200000-0000-4000-8000-000000000004";
const broken = "fd200000-0000-4000-8000-000000000005";
const group = "fd300000-0000-4000-8000-000000000001";

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
  groups: [{ id: group, name: "Cumpleaños", tableIds: [mateA, mateB] }],
  sectors: [{ id: sector, name: "Salón", position: 0 }],
  tables: [
    table(free, "5", 40),
    table(mateA, "17", 220),
    table(mateB, "18", 340),
    table(dirty, "9", 460),
    table(broken, "3", 580)
  ]
};

describeWithLocalStack("table entry with local Supabase", () => {
  const admin = postgres(databaseAdminUrl ?? "", { prepare: false });
  let app: NestFastifyApplication | undefined;
  const tokens = new Map<string, string>();

  async function cleanup() {
    for (const fixture of [one, two]) {
      await admin`delete from private.audit_events where tenant_id = ${fixture.tenantId}`;
      await admin`delete from private.location_publications where tenant_id = ${fixture.tenantId}`;
      await admin`delete from public.tenants where id = ${fixture.tenantId}`;
      await admin`delete from auth.users where id = ${fixture.userId}`;
    }
  }

  beforeAll(async () => {
    await cleanup();
    for (const [index, fixture] of [one, two].entries()) {
      await admin`insert into auth.users (id) values (${fixture.userId})`;
      await admin`
        insert into public.tenants (id, slug, name, status)
        values (${fixture.tenantId}, ${`entry-${index + 1}`}, 'Entry', 'active')
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
    const [location] = await admin<{ id: string }[]>`
      select id from public.locations where tenant_id = ${one.tenantId}
    `;
    const locationId = location!.id;
    await admin`
      select private.save_floor_plan(
        ${one.tenantId}::uuid, ${locationId}::uuid, ${one.userId}::uuid,
        'fd400000-0000-4000-8000-000000000001'::uuid, 0, ${admin.json(plan)}
      )
    `;
    const rows = await admin<{ label: string; token: string }[]>`
      select label, token
      from private.list_floor_table_qr_codes(
        ${one.tenantId}::uuid, ${locationId}::uuid, ${one.userId}::uuid
      )
    `;
    for (const row of rows) tokens.set(row.label, row.token);
    await admin`
      insert into private.floor_table_service_states
        (tenant_id, location_id, table_id, state)
      values
        (${one.tenantId}, ${locationId}, ${mateB}, 'occupied'),
        (${one.tenantId}, ${locationId}, ${dirty}, 'needs_cleaning'),
        (${one.tenantId}, ${locationId}, ${broken}, 'out_of_service')
    `;
    await admin`
      insert into private.location_publications
        (tenant_id, location_id, published_by)
      values (${one.tenantId}, ${locationId}, ${one.userId})
    `;

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
      staffPinPepper: "test-pepper-with-at-least-32-characters",
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
  });

  afterAll(async () => {
    await app?.close();
    await cleanup();
    await admin.end();
  });

  async function enter(host: string, token: string) {
    const response = await app!.getHttpAdapter().getInstance().inject({
      headers: { host },
      method: "POST",
      payload: { token },
      url: "/v1/public/table-entry"
    });
    return { body: response.json(), status: response.statusCode };
  }

  it("lets a diner start on a free table and shows its floor", async () => {
    const { body, status } = await enter(one.hostname, tokens.get("5")!);
    expect(status).toBe(200);
    expect(body.data).toMatchObject({
      entry: {
        canConfirmOrder: true,
        group: null,
        mode: "start",
        table: { floorName: "Terraza", label: "5" }
      },
      status: "ok"
    });
  });

  it("joins every table of a group once one of them is occupied", async () => {
    for (const label of ["17", "18"]) {
      const { body } = await enter(one.hostname, tokens.get(label)!);
      expect(body.data.entry).toMatchObject({
        group: { name: "Cumpleaños", tableLabels: ["17", "18"] },
        mode: "join"
      });
    }
  });

  it.each([
    ["9", "needs_cleaning"],
    ["3", "out_of_service"]
  ])("only allows menu and waiter on table %s (%s)", async (label, reason) => {
    const { body } = await enter(one.hostname, tokens.get(label)!);
    expect(body.data.entry).toMatchObject({
      canCallWaiter: true,
      canConfirmOrder: false,
      mode: "view_only",
      reason
    });
  });

  it("answers the same for unknown, malformed and other-tenant tokens", async () => {
    const unknown = await enter(one.hostname, "0".repeat(64));
    const malformed = await enter(one.hostname, "short");
    const foreign = await enter(two.hostname, tokens.get("5")!);
    for (const answer of [unknown, malformed, foreign]) {
      expect(answer).toEqual({
        body: { data: { status: "invalid" } },
        status: 200
      });
    }
  });

  it("never leaks the token or internal ids", async () => {
    const token = tokens.get("17")!;
    const { body } = await enter(one.hostname, token);
    const text = JSON.stringify(body);
    expect(text).not.toContain(token);
    expect(text).not.toContain(one.tenantId);
    expect(text).not.toContain(mateA);
  });

  it("does not resolve an unknown host", async () => {
    const answer = await enter("nadie.plataforma.test", tokens.get("5")!);
    expect(answer.status).toBe(404);
  });

  it("stops accepting new tables while closing, but keeps open ones", async () => {
    await admin`
      insert into public.platform_superadmins (user_id) values (${one.userId})
    `;
    await admin`
      insert into private.tenant_suspensions
        (tenant_id, mode, phase, reason, requested_by, correlation_id)
      values (${one.tenantId}, 'commercial', 'commercial_draining',
        'cierre de prueba', ${one.userId}, 'entry-test')
    `;
    const fresh = await enter(one.hostname, tokens.get("5")!);
    expect(fresh.body.data.entry).toMatchObject({
      canConfirmOrder: false,
      mode: "view_only",
      reason: "not_accepting"
    });
    const open = await enter(one.hostname, tokens.get("17")!);
    expect(open.body.data.entry).toMatchObject({ mode: "join" });
    await admin`delete from private.tenant_suspensions where tenant_id = ${one.tenantId}`;
    await admin`delete from public.platform_superadmins where user_id = ${one.userId}`;
  });

  it("reports an unpublished business as unavailable", async () => {
    await admin`delete from private.location_publications where tenant_id = ${one.tenantId}`;
    const { body } = await enter(one.hostname, tokens.get("5")!);
    expect(body.data).toEqual({ status: "unavailable" });
  });

  it("answers 404 for a suspended business without telling it apart", async () => {
    await admin`update public.tenants set status = 'suspended' where id = ${one.tenantId}`;
    const answer = await enter(one.hostname, tokens.get("5")!);
    expect(answer.status).toBe(404);
  });
});
