import type { INestApplication } from "@nestjs/common";
import {
  FastifyAdapter,
  type NestFastifyApplication
} from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { ApiRuntimeConfig } from "@platform/config";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../app.module.js";

const databaseUrl = process.env.DATABASE_URL;
const databaseAdminUrl = process.env.DATABASE_ADMIN_URL;
const describeWithDatabase =
  databaseUrl && databaseAdminUrl ? describe : describe.skip;

describeWithDatabase("tenant host routing with local PostgreSQL", () => {
  const tenantA = "a5000000-0000-4000-8000-000000000005";
  const tenantB = "a6000000-0000-4000-8000-000000000006";
  const admin = postgres(databaseAdminUrl ?? "", { prepare: false });
  let app: INestApplication;

  beforeAll(async () => {
    await admin`delete from public.tenants where id in (${tenantA}, ${tenantB})`;
    await admin`
      insert into public.tenants (id, slug, name, status)
      values
        (${tenantA}, 'host-smoke-a', 'Host Smoke A', 'active'),
        (${tenantB}, 'host-smoke-b', 'Host Smoke B', 'active')
    `;
    await admin`
      insert into public.tenant_domains (
        tenant_id,
        hostname,
        kind,
        status,
        is_primary
      ) values
        (${tenantA}, 'host-a.plataforma.test', 'platform_subdomain', 'active', true),
        (${tenantB}, 'host-b.plataforma.test', 'platform_subdomain', 'active', true)
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
      staffPinPepper: "test-pepper-with-at-least-32-characters",
      supabaseSecretKey: "sb_secret_server-only-example",
      supabaseUrl: "https://auth.example.test"
    };
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.register(config)]
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
      { logger: false }
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
    await admin`delete from public.tenants where id in (${tenantA}, ${tenantB})`;
    await admin.end();
  });

  it("routes two local subdomains without accepting a spoofed forwarded host", async () => {
    const server = app.getHttpAdapter().getInstance();
    const responseA = await server.inject({
      headers: {
        host: "host-a.plataforma.test:3001",
        "x-forwarded-host": "host-b.plataforma.test"
      },
      method: "GET",
      url: "/v1/public/tenant-context"
    });
    const responseB = await server.inject({
      headers: { host: "host-b.plataforma.test:3001" },
      method: "GET",
      url: "/v1/public/tenant-context"
    });
    const unknown = await server.inject({
      headers: { host: "unknown.plataforma.test:3001" },
      method: "GET",
      url: "/v1/public/tenant-context"
    });

    expect(responseA.statusCode).toBe(200);
    expect(responseA.json()).toMatchObject({
      data: { tenant: { slug: "host-smoke-a" } }
    });
    expect(responseB.statusCode).toBe(200);
    expect(responseB.json()).toMatchObject({
      data: { tenant: { slug: "host-smoke-b" } }
    });
    expect(unknown.statusCode).toBe(404);
  });
});
