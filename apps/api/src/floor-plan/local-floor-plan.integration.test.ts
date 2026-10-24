import {
  FastifyAdapter,
  type NestFastifyApplication
} from "@nestjs/platform-fastify";
import { NestFactory } from "@nestjs/core";
import type { ApiRuntimeConfig } from "@platform/config";
import { importJWK, SignJWT, type JWK } from "jose";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../app.module.js";

const databaseUrl = process.env.DATABASE_URL;
const databaseAdminUrl = process.env.DATABASE_ADMIN_URL;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
const signingJwk = process.env.SUPABASE_TEST_SIGNING_JWK;
const hasLocalStack =
  databaseUrl &&
  databaseAdminUrl &&
  supabaseUrl &&
  supabaseSecretKey &&
  signingJwk;
const describeWithLocalStack = hasLocalStack ? describe : describe.skip;

type Fixture = {
  hostname: string;
  sessionId: string;
  tenantId: string;
  userId: string;
};

const one: Fixture = {
  hostname: "floor-one.plataforma.test",
  sessionId: "fc000000-0000-4000-8000-000000000012",
  tenantId: "fc000000-0000-4000-8000-000000000013",
  userId: "fc000000-0000-4000-8000-000000000011"
};
const two: Fixture = {
  hostname: "floor-two.plataforma.test",
  sessionId: "fc000000-0000-4000-8000-000000000022",
  tenantId: "fc000000-0000-4000-8000-000000000023",
  userId: "fc000000-0000-4000-8000-000000000021"
};

const groundFloor = "fc100000-0000-4000-8000-0000000000f1";
const salon = "fc100000-0000-4000-8000-000000000001";
const terraza = "fc100000-0000-4000-8000-000000000002";
const tableA = "fc200000-0000-4000-8000-000000000001";
const tableB = "fc200000-0000-4000-8000-000000000002";
const tableC = "fc200000-0000-4000-8000-000000000003";
const group = "fc300000-0000-4000-8000-000000000001";

function table(
  id: string,
  label: string,
  x: number,
  sectorId = salon,
  shape: "rectangle" | "round" | "square" = "square"
) {
  return {
    floorId: groundFloor,
    height: 100,
    id,
    label,
    rotation: 0,
    seatCount: 4,
    seatLayout: "perimeter" as const,
    sectorId,
    shape,
    width: 100,
    x,
    y: 60
  };
}

function plan(
  tables: ReturnType<typeof table>[],
  groups: { id: string; name: string; tableIds: string[] }[] = []
) {
  return {
    floors: [
      { id: groundFloor, name: "Planta baja", position: 0, shortName: "PB" }
    ],
    groups,
    sectors: [
      { id: salon, name: "Salón", position: 0 },
      { id: terraza, name: "Terraza", position: 1 }
    ],
    tables
  };
}

describeWithLocalStack("floor plan with local Supabase", () => {
  const admin = postgres(databaseAdminUrl ?? "", { prepare: false });
  let app: NestFastifyApplication | undefined;
  let privateJwk: JWK;

  async function cleanup() {
    for (const fixture of [one, two]) {
      await admin`delete from private.audit_events where tenant_id = ${fixture.tenantId}`;
      await admin`delete from public.tenants where id = ${fixture.tenantId}`;
      await admin`delete from auth.users where id = ${fixture.userId}`;
    }
  }

  beforeAll(async () => {
    privateJwk = {
      ...(JSON.parse(signingJwk ?? "{}") as JWK),
      key_ops: ["sign"]
    };
    await cleanup();
    for (const [index, fixture] of [one, two].entries()) {
      await admin`insert into auth.users (id) values (${fixture.userId})`;
      await admin`
        insert into auth.sessions (id, user_id, aal, created_at, updated_at)
        values (${fixture.sessionId}, ${fixture.userId}, 'aal2', now(), now())
      `;
      await admin`
        insert into public.tenants (id, slug, name, status)
        values (${fixture.tenantId}, ${`floor-${index + 1}`}, 'Floor', 'active')
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

    const config: ApiRuntimeConfig = {
      adminInviteRedirectUrl: "https://app.example.test/auth/callback",
      databaseUrl: databaseUrl ?? "",
      environment: "test",
      logLevel: "error",
      metricsPort: 9464,
      platformBaseDomain: "plataforma.test",
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

  async function headers(fixture: Fixture, host = fixture.hostname) {
    const key = await importJWK(privateJwk, "ES256");
    const token = await new SignJWT({
      aal: "aal2",
      role: "authenticated",
      session_id: fixture.sessionId
    })
      .setProtectedHeader({ alg: "ES256", kid: privateJwk.kid as string })
      .setSubject(fixture.userId)
      .setAudience("authenticated")
      .setIssuer(`${supabaseUrl}/auth/v1`)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(key);
    return { authorization: `Bearer ${token}`, host };
  }

  function server() {
    return app!.getHttpAdapter().getInstance();
  }

  async function call(
    fixture: Fixture,
    method: "GET" | "POST" | "PUT",
    url: string,
    payload?: unknown,
    host?: string
  ) {
    return server().inject({
      headers: await headers(fixture, host),
      method,
      payload: payload as never,
      url: `/v1/tenant/floor-plan${url}`
    });
  }

  it("runs create → move → group → save → reload → ungroup → download QR", async () => {
    const empty = await call(one, "GET", "");
    expect(empty.json()).toEqual({
      data: {
        plan: { floors: [], groups: [], sectors: [], tables: [] },
        version: 0
      }
    });

    const created = plan([
      table(tableA, "1", 40),
      table(tableB, "2", 220, salon, "round"),
      table(tableC, "T-1", 400, terraza)
    ]);
    const first = await call(one, "PUT", "", {
      commandId: "fc400000-0000-4000-8000-000000000001",
      expectedVersion: 0,
      plan: created
    });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json().data).toEqual({
      applied: true,
      plan: created,
      version: 1
    });

    const qrBefore = (await call(one, "GET", "/qr")).json().data as {
      label: string;
      svg: string;
      tableId: string;
      url: string;
    }[];
    expect(qrBefore).toHaveLength(3);
    expect(new Set(qrBefore.map(({ url }) => url)).size).toBe(3);
    for (const code of qrBefore) {
      expect(code.url).toMatch(
        /^https:\/\/floor-one\.plataforma\.test\/m\/[0-9a-f]{64}$/u
      );
      expect(code.url).not.toContain(code.tableId);
      expect(code.url).not.toContain(one.tenantId);
      expect(code.svg.startsWith("<svg")).toBe(true);
    }

    const moved = plan(
      [
        { ...table(tableA, "1", 900), y: 500 },
        { ...table(tableB, "2", 220, salon, "round"), height: 160, width: 160 },
        table(tableC, "T-1", 400, terraza)
      ],
      [{ id: group, name: "Cumpleaños", tableIds: [tableA, tableB] }]
    );
    const second = await call(one, "PUT", "", {
      commandId: "fc400000-0000-4000-8000-000000000002",
      expectedVersion: 1,
      plan: moved
    });
    expect(second.statusCode, second.body).toBe(200);

    const reloaded = (await call(one, "GET", "")).json().data;
    expect(reloaded).toEqual({ plan: moved, version: 2 });
    const qrGrouped = (await call(one, "GET", "/qr")).json().data as {
      tableId: string;
      url: string;
    }[];
    expect(qrGrouped.map(({ tableId, url }) => [tableId, url])).toEqual(
      qrBefore.map(({ tableId, url }) => [tableId, url])
    );

    const replay = await call(one, "PUT", "", {
      commandId: "fc400000-0000-4000-8000-000000000002",
      expectedVersion: 1,
      plan: moved
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().data).toMatchObject({ applied: false, version: 2 });

    const separated = plan(moved.tables, []);
    const third = await call(one, "PUT", "", {
      commandId: "fc400000-0000-4000-8000-000000000003",
      expectedVersion: 2,
      plan: separated
    });
    expect(third.statusCode, third.body).toBe(200);
    const qrSeparated = (await call(one, "GET", "/qr")).json().data as {
      tableId: string;
      url: string;
    }[];
    expect(qrSeparated.map(({ tableId, url }) => [tableId, url])).toEqual(
      qrBefore.map(({ tableId, url }) => [tableId, url])
    );

    const token = /\/m\/([0-9a-f]{64})$/u.exec(qrBefore[0]!.url)![1];
    const verified = await call(one, "POST", "/qr/verify", { token });
    expect(verified.json().data).toMatchObject({
      table: { group: null, label: "1", sectorName: "Salón", tableId: tableA },
      valid: true
    });
  });

  it("rejects stale versions, reused commands and bad geometry with clear errors", async () => {
    const stale = await call(one, "PUT", "", {
      commandId: "fc400000-0000-4000-8000-000000000010",
      expectedVersion: 1,
      plan: plan([table(tableA, "1", 40)])
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe("FLOOR_PLAN_VERSION_CONFLICT");

    const reused = await call(one, "PUT", "", {
      commandId: "fc400000-0000-4000-8000-000000000002",
      expectedVersion: 3,
      plan: plan([table(tableA, "1", 41)])
    });
    expect(reused.statusCode).toBe(409);
    expect(reused.json().error.code).toBe("FLOOR_PLAN_COMMAND_REUSED");

    const outside = await call(one, "PUT", "", {
      commandId: "fc400000-0000-4000-8000-000000000011",
      expectedVersion: 3,
      plan: plan([table(tableA, "1", 3950)])
    });
    expect(outside.statusCode).toBe(400);
    expect(outside.json().error.issues[0]).toMatchObject({
      code: "OUT_OF_BOUNDS",
      path: "plan.tables[0].x"
    });

    const injected = await call(one, "PUT", "", {
      commandId: "fc400000-0000-4000-8000-000000000012",
      expectedVersion: 3,
      plan: plan([table(tableA, "1", 40)]),
      tenantId: two.tenantId
    });
    expect(injected.statusCode).toBe(400);

    const unauthenticated = await server().inject({
      headers: { host: one.hostname },
      method: "GET",
      url: "/v1/tenant/floor-plan"
    });
    expect(unauthenticated.statusCode).toBe(401);
  });

  it("keeps tenants isolated for plan, QR download and verification", async () => {
    const otherPlan = await call(two, "GET", "");
    expect(otherPlan.json().data).toEqual({
      plan: { floors: [], groups: [], sectors: [], tables: [] },
      version: 0
    });
    expect((await call(two, "GET", "/qr")).json().data).toEqual([]);

    const crossHost = await call(two, "GET", "", undefined, one.hostname);
    expect([403, 404]).toContain(crossHost.statusCode);
    const crossWrite = await call(
      two,
      "PUT",
      "",
      {
        commandId: "fc400000-0000-4000-8000-000000000020",
        expectedVersion: 3,
        plan: plan([table(tableA, "hack", 40)])
      },
      one.hostname
    );
    expect([403, 404]).toContain(crossWrite.statusCode);

    const [first] = (await call(one, "GET", "/qr")).json().data as {
      url: string;
    }[];
    const token = /\/m\/([0-9a-f]{64})$/u.exec(first!.url)![1];
    const foreign = await call(two, "POST", "/qr/verify", { token });
    expect(foreign.json().data).toEqual({ valid: false });

    // The same table ids may exist in another tenant without any collision.
    const twin = await call(two, "PUT", "", {
      commandId: "fc400000-0000-4000-8000-000000000021",
      expectedVersion: 0,
      plan: plan([table(tableA, "1", 40)])
    });
    expect(twin.statusCode, twin.body).toBe(200);
    const twinQr = (await call(two, "GET", "/qr")).json().data as {
      url: string;
    }[];
    expect(twinQr[0]?.url).not.toBe(first?.url);
    const stillOne = (await call(one, "GET", "")).json().data;
    expect(stillOne.plan.tables).toHaveLength(3);
  });

  it("rotates a QR so the previous code stops verifying", async () => {
    const before = (await call(one, "GET", "/qr")).json().data as {
      tableId: string;
      url: string;
    }[];
    const target = before.find(({ tableId }) => tableId === tableB)!;
    const oldToken = /\/m\/([0-9a-f]{64})$/u.exec(target.url)![1];

    const rotated = await call(one, "POST", `/tables/${tableB}/qr/rotate`);
    expect(rotated.statusCode).toBe(204);

    const after = (await call(one, "GET", "/qr")).json().data as {
      tableId: string;
      url: string;
    }[];
    expect(after.find(({ tableId }) => tableId === tableB)!.url).not.toBe(
      target.url
    );
    const stale = await call(one, "POST", "/qr/verify", { token: oldToken });
    expect(stale.json().data).toEqual({ valid: false });
  });
  it("splits the plan into floors, moves a table between them and keeps its QR", async () => {
    const upperFloor = "fc100000-0000-4000-8000-0000000000f2";
    const read = async () =>
      (await call(one, "GET", "")).json().data as {
        plan: ReturnType<typeof plan>;
        version: number;
      };
    const qrOf = async (id: string) =>
      (
        (await call(one, "GET", "/qr")).json().data as {
          tableId: string;
          url: string;
        }[]
      ).find(({ tableId }) => tableId === id)?.url;

    const current = await read();
    expect(current.plan.floors).toHaveLength(1);
    const before = await qrOf(tableA);

    const floors = [
      ...current.plan.floors,
      { id: upperFloor, name: "Planta alta", position: 1, shortName: "PA" }
    ];
    const moved = await call(one, "PUT", "", {
      commandId: "fc400000-0000-4000-8000-000000000031",
      expectedVersion: current.version,
      plan: {
        ...current.plan,
        floors,
        tables: current.plan.tables.map((item) =>
          item.id === tableA ? { ...item, floorId: upperFloor } : item
        )
      }
    });
    expect(moved.statusCode, moved.body).toBe(200);
    const stored = moved.json().data.plan;
    expect(stored.floors.map((floor: { name: string }) => floor.name)).toEqual([
      "Planta baja",
      "Planta alta"
    ]);
    expect(
      stored.tables.find((item: { id: string }) => item.id === tableA).floorId
    ).toBe(upperFloor);
    expect(await qrOf(tableA)).toBe(before);

    // A group cannot mix floors, and a table cannot use a floor that does not exist.
    const mixed = await call(one, "PUT", "", {
      commandId: "fc400000-0000-4000-8000-000000000032",
      expectedVersion: (await read()).version,
      plan: {
        ...stored,
        groups: [{ id: group, name: "Mixta", tableIds: [tableA, tableB] }]
      }
    });
    expect(mixed.statusCode).toBe(400);
    expect(JSON.stringify(mixed.json())).toContain("MIXED_FLOORS");
    const unknown = await call(one, "PUT", "", {
      commandId: "fc400000-0000-4000-8000-000000000033",
      expectedVersion: (await read()).version,
      plan: {
        ...stored,
        tables: stored.tables.map((item: { id: string }) =>
          item.id === tableB
            ? { ...item, floorId: "fc100000-0000-4000-8000-0000000000f9" }
            : item
        )
      }
    });
    expect(unknown.statusCode).toBe(400);
    expect(JSON.stringify(unknown.json())).toContain("UNKNOWN_FLOOR");

    // The other tenant has none of these floors and cannot use them.
    const other = (await call(two, "GET", "")).json().data.plan;
    expect(other.floors.map((floor: { id: string }) => floor.id)).not.toContain(
      upperFloor
    );
    const crossUse = await call(two, "PUT", "", {
      commandId: "fc400000-0000-4000-8000-000000000034",
      expectedVersion: (await call(two, "GET", "")).json().data.version,
      plan: {
        floors: [],
        groups: [],
        sectors: [{ id: salon, name: "Salón", position: 0 }],
        tables: [table(tableA, "9", 40)]
      }
    });
    expect(crossUse.statusCode).toBe(400);
    expect(JSON.stringify(crossUse.json())).toContain("UNKNOWN_FLOOR");
  });
});
