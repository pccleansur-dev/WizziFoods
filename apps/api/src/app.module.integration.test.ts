import type { INestApplication } from "@nestjs/common";
import {
  FastifyAdapter,
  type NestFastifyApplication
} from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { ApiRuntimeConfig } from "@platform/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AdminAuthService } from "./auth/admin-auth.service.js";
import { AppModule } from "./app.module.js";
import { StaffAuthService } from "./staff-auth/staff-auth.service.js";
import { TenantContextService } from "./tenants/tenant-context.service.js";

describe("API authentication boundaries", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const config: ApiRuntimeConfig = {
      databaseUrl: "postgresql://unused:unused@127.0.0.1:1/unused",
      environment: "test",
      logLevel: "error",
      metricsPort: 9464,
      port: 3001,
      staffPinPepper: "test-pepper-with-at-least-32-characters",
      supabaseUrl: "https://auth.example.test"
    };
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.register(config)]
    })
      .overrideProvider(AdminAuthService)
      .useValue({
        authenticate: async () => ({
          assuranceLevel: "aal2",
          userId: "10000000-0000-4000-8000-000000000001"
        })
      })
      .overrideProvider(TenantContextService)
      .useValue({
        getForAuthenticatedIdentity: async () => ({
          tenantContexts: [],
          type: "tenant_admin"
        })
      })
      .overrideProvider(StaffAuthService)
      .useValue({
        currentSession: async () => ({ active: true }),
        revalidate: async () => ({
          revalidatedAt: "2026-10-21T18:00:00.000Z"
        }),
        signIn: async (tenantSlug: string, request: unknown) => ({
          accessToken: "a".repeat(43),
          request,
          tenantSlug
        }),
        signOut: async () => undefined
      })
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
      { logger: false }
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("keeps the health check public", async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/health"
    });

    expect(response.statusCode).toBe(200);
  });

  it("rejects tenant context requests without a bearer token", async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/v1/me/access"
    });

    expect(response.statusCode).toBe(401);
  });

  it("returns tenant context to an authenticated aal2 identity", async () => {
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        headers: { authorization: "Bearer signed-token" },
        method: "GET",
        url: "/v1/me/access"
      });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: {
        identity: {
          assuranceLevel: "aal2",
          userId: "10000000-0000-4000-8000-000000000001"
        },
        access: { tenantContexts: [], type: "tenant_admin" }
      }
    });
  });

  it("creates a normalized staff session", async () => {
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "POST",
        payload: { pin: "194827", username: "  Ana.Moza " },
        url: "/v1/tenants/restaurante-demo/staff-sessions"
      });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      data: {
        accessToken: "a".repeat(43),
        request: { pin: "194827", username: "ana.moza" },
        tenantSlug: "restaurante-demo"
      }
    });
  });

  it("rejects malformed staff login and missing session credentials", async () => {
    const login = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "POST",
        payload: { pin: "123", username: "ana" },
        url: "/v1/tenants/restaurante-demo/staff-sessions"
      });
    const currentSession = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/v1/staff-sessions/current"
    });

    expect(login.statusCode).toBe(400);
    expect(currentSession.statusCode).toBe(401);
  });
});
