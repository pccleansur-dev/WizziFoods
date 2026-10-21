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
const signingJwk = process.env.SUPABASE_TEST_SIGNING_JWK;
const hasLocalStack =
  databaseUrl && databaseAdminUrl && supabaseUrl && signingJwk;
const describeWithLocalStack = hasLocalStack ? describe : describe.skip;

describeWithLocalStack("administrative API with local Supabase", () => {
  const userId = "30000000-0000-4000-8000-000000000003";
  const tenantId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const admin = postgres(databaseAdminUrl ?? "", { prepare: false });
  let app: NestFastifyApplication;
  let keyId: string;
  let privateJwk: JWK;

  beforeAll(async () => {
    privateJwk = {
      ...(JSON.parse(signingJwk ?? "{}") as JWK),
      key_ops: ["sign"]
    };
    if (typeof privateJwk.kid !== "string") {
      throw new Error("The local Supabase signing key must include a kid");
    }
    keyId = privateJwk.kid;
    await admin`delete from public.tenants where id = ${tenantId}`;
    await admin`delete from auth.users where id = ${userId}`;
    await admin`insert into auth.users (id) values (${userId})`;
    await admin`
      insert into public.tenants (id, slug, name, status)
      values (${tenantId}, 'api-auth-test', 'API Auth Test', 'active')
    `;
    await admin`
      insert into public.tenant_memberships (tenant_id, user_id, role)
      values (${tenantId}, ${userId}, 'admin')
    `;

    const config: ApiRuntimeConfig = {
      databaseUrl: databaseUrl ?? "",
      environment: "test",
      logLevel: "error",
      metricsPort: 9464,
      port: 3001,
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
    await app.close();
    await admin`delete from public.tenants where id = ${tenantId}`;
    await admin`delete from auth.users where id = ${userId}`;
    await admin.end();
  });

  async function createToken(aal: "aal1" | "aal2"): Promise<string> {
    const privateKey = await importJWK(privateJwk, "ES256");

    return new SignJWT({ aal, role: "authenticated" })
      .setProtectedHeader({ alg: "ES256", kid: keyId })
      .setSubject(userId)
      .setAudience("authenticated")
      .setIssuer(`${supabaseUrl}/auth/v1`)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
  }

  it("returns only the authenticated administrator tenant", async () => {
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        headers: { authorization: `Bearer ${await createToken("aal2")}` },
        method: "GET",
        url: "/v1/me/tenant-context"
      });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.tenantContexts).toEqual([
      expect.objectContaining({
        tenant: expect.objectContaining({ id: tenantId, slug: "api-auth-test" })
      })
    ]);
  });

  it("requires the administrator to complete MFA", async () => {
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        headers: { authorization: `Bearer ${await createToken("aal1")}` },
        method: "GET",
        url: "/v1/me/tenant-context"
      });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: {
        code: "MFA_REQUIRED",
        message: "Se requiere el segundo factor para continuar."
      }
    });
  });
});
