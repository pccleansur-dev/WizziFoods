import { randomUUID } from "node:crypto";

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
  slug: string;
  tenantId: string;
  userId: string;
};

// Cada corrida usa identidades propias: publicar deja filas que la limpieza
// local (rol postgres) no puede borrar en tablas de T11 (supabase_admin).
function fixture(label: string): Fixture {
  const run = randomUUID().slice(0, 8);
  return {
    hostname: `alta-${label}-${run}.plataforma.test`,
    sessionId: randomUUID(),
    slug: `alta-${label}-${run}`,
    tenantId: randomUUID(),
    userId: randomUUID()
  };
}

const one = fixture("one");
const two = fixture("two");

const categoryId = "fe100000-0000-4000-8000-000000000001";
const productId = "fe100000-0000-4000-8000-000000000002";
const sectorId = "fe100000-0000-4000-8000-000000000003";
const salonId = "fe100000-0000-4000-8000-000000000004";
const tableId = "fe100000-0000-4000-8000-000000000005";
const pendingTitle = "Plato importado sin aprobar";
const draftOnlyTitle = "Plato solo en borrador";

const profile = {
  address: "Av. Demo 123",
  contactPhone: "+54 11 5555 0000",
  coverAssetId: null,
  description: "Cocina de barrio.",
  displayName: "Alta Uno",
  languages: ["es"],
  logoAssetId: null,
  openingHours: "Todos los días",
  referenceAssetIds: [],
  visual: {
    accentColor: "#D97706",
    headingStyle: "serif",
    layout: "visual",
    primaryColor: "#1F2937",
    secondaryColor: "#F9FAFB"
  }
};

function catalogDraft(extraTitle?: string) {
  const products = [
    {
      categoryId,
      content: [
        { description: "Con papas", language: "es", title: "Milanesa" }
      ],
      id: productId,
      imageAssetId: null,
      position: 0,
      priceCents: 125000,
      sectorId,
      variants: []
    },
    ...(extraTitle
      ? [
          {
            categoryId,
            content: [{ description: "", language: "es", title: extraTitle }],
            id: "fe100000-0000-4000-8000-000000000006",
            imageAssetId: null,
            position: 1,
            priceCents: 90000,
            sectorId,
            variants: []
          }
        ]
      : [])
  ];
  return {
    categories: [
      {
        content: [{ description: "", language: "es", title: "Principales" }],
        id: categoryId,
        position: 0
      }
    ],
    products,
    sectors: [{ id: sectorId, kind: "kitchen", name: "Cocina", position: 0 }]
  };
}

const groundFloorId = "fe100000-0000-4000-8000-0000000000f1";

const floorPlan = (version: number, command: string) => ({
  commandId: command,
  expectedVersion: version,
  plan: {
    floors: [
      { id: groundFloorId, name: "Planta baja", position: 0, shortName: null }
    ],
    groups: [],
    sectors: [{ id: salonId, name: "Salón", position: 0 }],
    tables: [
      {
        floorId: groundFloorId,
        height: 80,
        id: tableId,
        label: "1",
        rotation: 0,
        seatCount: 4,
        seatLayout: "perimeter",
        sectorId: salonId,
        shape: "rectangle",
        width: 100,
        x: 40,
        y: 40
      }
    ]
  }
});

describeWithLocalStack("sign-up journey with local Supabase", () => {
  const admin = postgres(databaseAdminUrl ?? "", { prepare: false });
  let app: NestFastifyApplication | undefined;
  let privateJwk: JWK;

  async function cleanup() {
    for (const item of [one, two]) {
      await admin`delete from private.location_publications where tenant_id = ${item.tenantId}`.catch(
        () => undefined
      );
      await admin`delete from private.audit_events where tenant_id = ${item.tenantId}`.catch(
        () => undefined
      );
      await admin`delete from public.tenants where id = ${item.tenantId}`.catch(
        () => undefined
      );
      await admin`delete from auth.users where id = ${item.userId}`.catch(
        () => undefined
      );
    }
  }

  beforeAll(async () => {
    privateJwk = {
      ...(JSON.parse(signingJwk ?? "{}") as JWK),
      key_ops: ["sign"]
    };
    for (const fixture of [one, two]) {
      await admin`insert into auth.users (id) values (${fixture.userId})`;
      await admin`
        insert into auth.sessions (id, user_id, aal, created_at, updated_at)
        values (${fixture.sessionId}, ${fixture.userId}, 'aal2', now(), now())
      `;
      await admin`
        insert into public.tenants (id, slug, name, status)
        values (${fixture.tenantId}, ${fixture.slug}, 'Alta', 'active')
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
      paymentSecretKey: Buffer.alloc(32, 5),
      platformBaseDomain: "plataforma.test",
      platformTenantHostTemplate: "{slug}.{domain}",
      port: 3001,
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

  async function call(
    fixture: Fixture,
    method: "DELETE" | "GET" | "POST" | "PUT",
    url: string,
    payload?: unknown,
    host = fixture.hostname
  ) {
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
    return app!
      .getHttpAdapter()
      .getInstance()
      .inject({
        headers: { authorization: `Bearer ${token}`, host },
        method,
        payload: payload as never,
        url
      });
  }

  const codes = (body: { data: { items: { code: string }[] } }) =>
    body.data.items.map((item) => item.code).sort();

  /** Everything real operation reads, to prove the simulation never moves it. */
  async function realState(fixture: Fixture) {
    const [row] = await admin<{ state: string }[]>`
      select md5(concat_ws('|',
        (select coalesce(string_agg(m::text, ',' order by method_key), '')
          from private.payment_methods m where tenant_id = ${fixture.tenantId}),
        (select count(*)::text from private.payment_method_secrets
          where tenant_id = ${fixture.tenantId}),
        (select coalesce(string_agg(t::text, ',' order by id), '')
          from private.floor_tables t where tenant_id = ${fixture.tenantId}),
        (select coalesce(string_agg(q::text, ',' order by id), '')
          from private.floor_table_qr_codes q where tenant_id = ${fixture.tenantId}),
        (select coalesce(string_agg(p::text, ',' order by id), '')
          from private.published_catalogs p where tenant_id = ${fixture.tenantId}),
        (select count(*)::text from public.staff_members
          where tenant_id = ${fixture.tenantId}),
        (select count(*)::text from private.location_publications
          where tenant_id = ${fixture.tenantId})
      )) as state
    `;
    return row?.state;
  }

  it("lists what is missing, explains it and never blocks saving progress", async () => {
    const initial = await call(one, "GET", "/v1/tenant/readiness");
    expect(initial.statusCode, initial.body).toBe(200);
    expect(codes(initial.json())).toEqual([
      "CATALOG_NOT_PUBLISHED",
      "FLOOR_NO_TABLES",
      "PROFILE_MISSING",
      "TEAM_EMPTY"
    ]);
    expect(initial.json().data.ready).toBe(false);
    for (const item of initial.json().data.items) {
      expect(item.message.length).toBeGreaterThan(20);
      expect(item.href).toMatch(/^\/panel/u);
    }

    const refused = await call(one, "POST", "/v1/tenant/publication", {});
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe("BUSINESS_NOT_READY");
    expect(refused.json().error.readiness.ready).toBe(false);

    const noPrerequisites = await call(
      one,
      "POST",
      "/v1/tenant/sandbox/runs",
      {}
    );
    expect(noPrerequisites.statusCode).toBe(422);
    expect(noPrerequisites.json().error.code).toBe(
      "SANDBOX_PREREQUISITES_MISSING"
    );

    // Progress saves are never blocked by the unmet minimums.
    expect(
      (await call(one, "PUT", "/v1/tenant/business-profile", profile))
        .statusCode
    ).toBe(200);
    const draft = await call(one, "PUT", "/v1/tenant/catalog/draft", {
      baseRevision: null,
      ...catalogDraft()
    });
    expect(draft.statusCode, draft.body).toBe(200);
    expect(
      (
        await call(
          one,
          "PUT",
          "/v1/tenant/floor-plan",
          floorPlan(0, "fe200000-0000-4000-8000-000000000001")
        )
      ).statusCode
    ).toBe(200);
  });

  it("keeps drafts and pending imports out of production until they are published", async () => {
    const queued = await call(one, "POST", "/v1/tenant/catalog-imports", {
      idempotencyKey: "fe300000-0000-4000-8000-000000000001",
      source: {
        kind: "manual",
        rows: [
          {
            category: "Principales",
            description: "",
            name: pendingTitle,
            price: "1000",
            sector: "Cocina"
          }
        ]
      }
    });
    expect(queued.statusCode, queued.body).toBe(202);

    const publishCatalog = await call(
      one,
      "POST",
      "/v1/tenant/catalog/publish",
      {
        expectedDraftRevision: 1
      }
    );
    expect(publishCatalog.statusCode, publishCatalog.body).toBe(201);

    // A later edit stays a draft; the pending import was never approved.
    const edited = await call(one, "PUT", "/v1/tenant/catalog/draft", {
      baseRevision: 1,
      ...catalogDraft(draftOnlyTitle)
    });
    expect(edited.statusCode, edited.body).toBe(200);

    const readiness = await call(one, "GET", "/v1/tenant/readiness");
    expect(codes(readiness.json())).toEqual([
      "CATALOG_DRAFT_UNPUBLISHED",
      "CATALOG_IMPORTS_PENDING",
      "TEAM_EMPTY"
    ]);
    expect(readiness.json().data.ready).toBe(true);

    const [published] = await admin<{ snapshot: string }[]>`
      select snapshot::text as snapshot from private.published_catalogs
      where tenant_id = ${one.tenantId} order by revision desc limit 1
    `;
    expect(published?.snapshot).toContain("Milanesa");
    expect(published?.snapshot).not.toContain(pendingTitle);
    expect(published?.snapshot).not.toContain(draftOnlyTitle);

    const customerCatalog = await app!
      .getHttpAdapter()
      .getInstance()
      .inject({
        headers: { host: one.hostname },
        method: "GET",
        url: "/v1/public/catalog"
      });
    expect(customerCatalog.body).not.toContain(pendingTitle);
    expect(customerCatalog.body).not.toContain(draftOnlyTitle);
  });

  it("simulates the full circuit without touching real state and leaves nothing behind", async () => {
    const before = await realState(one);
    const [realBefore] = await admin<{ count: string }[]>`
      select count(*)::text from private.audit_events
      where tenant_id = ${one.tenantId} and action not like 'sandbox.%'
    `;

    const result = await call(one, "POST", "/v1/tenant/sandbox/runs", {});
    expect(result.statusCode, result.body).toBe(200);
    const run = result.json().data;
    expect(run.namespace).toBe("sandbox");
    expect(run.reference).toMatch(/^SBX-/u);
    expect(run.steps.map((step: { step: string }) => step.step)).toEqual([
      "qr_scanned",
      "order_placed",
      "in_production",
      "payment_recorded",
      "closed",
      "cleaned_up"
    ]);
    expect(run.steps.every((step: { ok: boolean }) => step.ok)).toBe(true);

    expect(await realState(one)).toBe(before);
    const [leftovers] = await admin<{ count: string }[]>`
      select count(*)::text from private.sandbox_orders where tenant_id = ${one.tenantId}
    `;
    expect(leftovers?.count).toBe("0");
    const [events] = await admin<{ count: string }[]>`
      select count(*)::text from private.audit_events
      where tenant_id = ${one.tenantId} and action not like 'sandbox.%'
    `;
    expect(events?.count).toBe(realBefore?.count);
    const sandboxEvents = await admin<{ action: string }[]>`
      select action from private.audit_events
      where tenant_id = ${one.tenantId} and action like 'sandbox.%'
    `;
    expect(sandboxEvents.map((event) => event.action)).toEqual([
      "sandbox.run_completed"
    ]);
    expect(JSON.stringify(run)).not.toMatch(/token|secret|pin/iu);

    const cleaned = await call(one, "DELETE", "/v1/tenant/sandbox");
    expect(cleaned.json()).toEqual({ data: { removed: 0 } });
  });

  it("isolates tenants for readiness, simulation and publication", async () => {
    const other = await call(two, "GET", "/v1/tenant/readiness");
    expect(codes(other.json())).toEqual([
      "CATALOG_NOT_PUBLISHED",
      "FLOOR_NO_TABLES",
      "PROFILE_MISSING",
      "TEAM_EMPTY"
    ]);
    expect(other.json().data.published).toBeNull();
    expect(
      (await call(two, "POST", "/v1/tenant/sandbox/runs", {})).statusCode
    ).toBe(422);

    const crossHost = await call(
      two,
      "POST",
      "/v1/tenant/publication",
      {},
      one.hostname
    );
    expect([403, 404]).toContain(crossHost.statusCode);
    const injected = await call(one, "POST", "/v1/tenant/publication", {
      locationId: "x",
      tenantId: two.tenantId
    });
    expect(injected.statusCode).toBe(400);

    const anonymous = await app!
      .getHttpAdapter()
      .getInstance()
      .inject({
        headers: { host: one.hostname },
        method: "POST",
        payload: {},
        url: "/v1/tenant/publication"
      });
    expect(anonymous.statusCode).toBe(401);
    const [published] = await admin<{ count: string }[]>`
      select count(*)::text from private.location_publications
      where tenant_id = ${two.tenantId}
    `;
    expect(published?.count).toBe("0");
  });

  it("revalidates inside the publication transaction, even against a concurrent save", async () => {
    // A writer holds the floor plan while the Administrator presses publish.
    let writerLocked!: () => void;
    const locked = new Promise<void>((resolve) => (writerLocked = resolve));
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    const writer = admin.begin(async (transaction) => {
      await transaction`
        select 1 from private.floor_plans where tenant_id = ${one.tenantId} for update
      `;
      writerLocked();
      await released;
      await transaction`
        update private.floor_tables set retired_at = now(), sector_id = null, level_id = null
        where tenant_id = ${one.tenantId} and retired_at is null
      `;
    });
    await locked;

    const publishing = call(one, "POST", "/v1/tenant/publication", {});
    await new Promise((resolve) => setTimeout(resolve, 500));
    release();
    await writer;
    const refused = await publishing;

    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json().error.code).toBe("BUSINESS_NOT_READY");
    const [state] = await admin<{ count: string }[]>`
      select count(*)::text from private.location_publications
      where tenant_id = ${one.tenantId}
    `;
    expect(state?.count).toBe("0");
  });

  it("publishes once, audited, only after every minimum is met", async () => {
    const restored = await call(one, "PUT", "/v1/tenant/floor-plan", {
      commandId: "fe200000-0000-4000-8000-000000000002",
      expectedVersion: 1,
      plan: {
        floors: [
          {
            id: groundFloorId,
            name: "Planta baja",
            position: 0,
            shortName: null
          }
        ],
        groups: [],
        sectors: [{ id: salonId, name: "Salón", position: 0 }],
        tables: [
          {
            floorId: groundFloorId,
            height: 80,
            id: "fe100000-0000-4000-8000-000000000007",
            label: "2",
            rotation: 0,
            seatCount: 4,
            seatLayout: "perimeter",
            sectorId: salonId,
            shape: "rectangle",
            width: 100,
            x: 200,
            y: 40
          }
        ]
      }
    });
    expect(restored.statusCode, restored.body).toBe(200);

    const published = await call(one, "POST", "/v1/tenant/publication", {});
    expect(published.statusCode, published.body).toBe(200);
    expect(published.json().data.published.revision).toBe(1);

    const again = await call(one, "POST", "/v1/tenant/publication", {});
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe("BUSINESS_ALREADY_PUBLISHED");

    const events = await admin<{ action: string; actor_id: string }[]>`
      select action, actor_id from private.audit_events
      where tenant_id = ${one.tenantId} and action = 'business.published'
    `;
    expect(events).toHaveLength(1);
    expect(events[0]?.actor_id).toBe(one.userId);

    const [other] = await admin<{ count: string }[]>`
      select count(*)::text from private.location_publications
      where tenant_id = ${two.tenantId}
    `;
    expect(other?.count).toBe("0");
  });
});
