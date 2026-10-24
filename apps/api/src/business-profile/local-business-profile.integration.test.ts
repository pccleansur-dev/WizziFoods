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

describeWithLocalStack("business profile with local Supabase", () => {
  const userId = "da000000-0000-4000-8000-000000000001";
  const sessionId = "da000000-0000-4000-8000-000000000002";
  const tenantId = "da000000-0000-4000-8000-000000000003";
  const hostname = "profile-flow.plataforma.test";
  const admin = postgres(databaseAdminUrl ?? "", { prepare: false });
  let app: NestFastifyApplication | undefined;
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
      insert into auth.sessions (id, user_id, aal, created_at, updated_at)
      values (${sessionId}, ${userId}, 'aal2', now(), now())
    `;
    await admin`
      insert into public.tenants (id, slug, name, status)
      values (${tenantId}, 'profile-flow', 'Profile Flow', 'draft')
    `;
    await admin`
      insert into public.tenant_memberships (tenant_id, user_id, role)
      values (${tenantId}, ${userId}, 'admin')
    `;
    await admin`
      insert into public.tenant_domains (
        tenant_id, hostname, kind, status, is_primary
      ) values (
        ${tenantId}, ${hostname}, 'platform_subdomain', 'active', true
      )
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
    await admin`delete from public.tenants where id = ${tenantId}`;
    await admin`delete from auth.users where id = ${userId}`;
    await admin.end();
  });

  async function createToken(): Promise<string> {
    const privateKey = await importJWK(privateJwk, "ES256");
    return new SignJWT({
      aal: "aal2",
      role: "authenticated",
      session_id: sessionId
    })
      .setProtectedHeader({ alg: "ES256", kid: keyId })
      .setSubject(userId)
      .setAudience("authenticated")
      .setIssuer(`${supabaseUrl}/auth/v1`)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
  }

  it("saves and reloads a draft with ready tenant-scoped media", async () => {
    const server = app!.getHttpAdapter().getInstance();
    const headers = {
      authorization: `Bearer ${await createToken()}`,
      host: hostname
    };
    const emptyProfile = await server.inject({
      headers,
      method: "GET",
      url: "/v1/tenant/business-profile"
    });
    expect(emptyProfile.statusCode).toBe(200);
    expect(emptyProfile.json()).toEqual({ data: null });

    const reservation = await server.inject({
      headers,
      method: "POST",
      payload: {
        byteLength: 1024,
        contentType: "image/png",
        kind: "logo"
      },
      url: "/v1/tenant/business-media/reservations"
    });
    expect(reservation.statusCode, reservation.body).toBe(201);
    const reserved = reservation.json().data as {
      id: string;
      uploadUrl: string;
    };
    expect(new URL(reserved.uploadUrl).origin).toBe(
      new URL(supabaseUrl!).origin
    );

    await admin`
      select private.complete_business_media_asset(
        ${tenantId}::uuid,
        ${reserved.id}::uuid,
        768::bigint,
        640::integer,
        480::integer,
        ${"a".repeat(64)}
      )
    `;

    const draft = {
      address: "Av. Demo 123",
      contactPhone: "+54 9 11 5555 0000",
      coverAssetId: null,
      description: "Cocina de estación.",
      displayName: "Bodegón del Perfil",
      languages: ["es"],
      logoAssetId: reserved.id,
      openingHours: "Martes a domingo",
      referenceAssetIds: [],
      visual: {
        accentColor: "#D97706",
        headingStyle: "serif",
        layout: "visual",
        primaryColor: "#1F2937",
        secondaryColor: "#F9FAFB"
      }
    };
    const saved = await server.inject({
      headers,
      method: "PUT",
      payload: draft,
      url: "/v1/tenant/business-profile"
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json().data).toMatchObject({
      ...draft,
      revision: 1
    });

    const resumed = await server.inject({
      headers: {
        authorization: `Bearer ${await createToken()}`,
        host: hostname
      },
      method: "GET",
      url: "/v1/tenant/business-profile"
    });
    expect(resumed.statusCode, resumed.body).toBe(200);
    expect(resumed.json().data).toMatchObject({
      ...draft,
      revision: 1
    });
  });
});
