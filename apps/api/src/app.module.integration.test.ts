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
import { TenantContextService } from "./tenants/tenant-context.service.js";

describe("administrative API authentication boundary", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const config: ApiRuntimeConfig = {
      databaseUrl: "postgresql://unused:unused@127.0.0.1:1/unused",
      environment: "test",
      logLevel: "error",
      metricsPort: 9464,
      port: 3001,
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
      .useValue({ getForAuthenticatedIdentity: async () => [] })
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
      url: "/v1/me/tenant-context"
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
        url: "/v1/me/tenant-context"
      });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: {
        identity: {
          assuranceLevel: "aal2",
          userId: "10000000-0000-4000-8000-000000000001"
        },
        tenantContexts: []
      }
    });
  });
});
