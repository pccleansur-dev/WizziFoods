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

describeWithLocalStack("catalog lifecycle with local Supabase", () => {
  const userId = "fb000000-0000-4000-8000-000000000001";
  const sessionId = "fb000000-0000-4000-8000-000000000002";
  const tenantId = "fb000000-0000-4000-8000-000000000003";
  const categoryId = "fb000000-0000-4000-8000-000000000004";
  const sectorId = "fb000000-0000-4000-8000-000000000005";
  const productId = "fb000000-0000-4000-8000-000000000006";
  const variantId = "fb000000-0000-4000-8000-000000000007";
  const hostname = "catalog-flow.plataforma.test";
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

    await admin`delete from private.published_catalogs where tenant_id = ${tenantId}`;
    await admin`delete from public.tenants where id = ${tenantId}`;
    await admin`delete from auth.users where id = ${userId}`;
    await admin`insert into auth.users (id) values (${userId})`;
    await admin`
      insert into auth.sessions (id, user_id, aal, created_at, updated_at)
      values (${sessionId}, ${userId}, 'aal2', now(), now())
    `;
    await admin`
      insert into public.tenants (id, slug, name, status)
      values (${tenantId}, 'catalog-flow', 'Catalog Flow', 'active')
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
    await admin`delete from private.published_catalogs where tenant_id = ${tenantId}`;
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

  it("covers draft, preview, publication, and immediate availability end to end", async () => {
    const server = app!.getHttpAdapter().getInstance();
    const adminHeaders = {
      authorization: `Bearer ${await createToken()}`,
      host: hostname
    };
    const profile = await server.inject({
      headers: adminHeaders,
      method: "PUT",
      payload: {
        address: "Av. Demo 123",
        contactPhone: "+54 11 5555 0000",
        coverAssetId: null,
        description: "Cocina de barrio.",
        displayName: "Catalog Flow",
        languages: ["es", "en"],
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
      },
      url: "/v1/tenant/business-profile"
    });
    expect(profile.statusCode, profile.body).toBe(200);

    const draft = {
      baseRevision: null,
      categories: [
        {
          content: [
            { description: "", language: "es", title: "Principales" },
            { description: "", language: "en", title: "Main dishes" }
          ],
          id: categoryId,
          position: 0
        }
      ],
      products: [
        {
          categoryId,
          content: [
            {
              description: "Con papas",
              language: "es",
              title: "Milanesa"
            },
            {
              description: "With potatoes",
              language: "en",
              title: "Milanese"
            }
          ],
          id: productId,
          imageAssetId: null,
          position: 0,
          priceCents: 125000,
          sectorId,
          variants: [
            {
              content: [
                { description: "", language: "es", title: "Napolitana" },
                { description: "", language: "en", title: "Neapolitan" }
              ],
              id: variantId,
              position: 0,
              priceDeltaCents: 25000
            }
          ]
        }
      ],
      sectors: [{ id: sectorId, kind: "kitchen", name: "Cocina", position: 0 }]
    };

    const saved = await server.inject({
      headers: adminHeaders,
      method: "PUT",
      payload: draft,
      url: "/v1/tenant/catalog/draft"
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json().data).toMatchObject({ isDirty: true, revision: 1 });

    const beforePublication = await server.inject({
      headers: { host: hostname },
      method: "GET",
      url: "/v1/public/catalog"
    });
    expect(beforePublication.statusCode, beforePublication.body).toBe(200);
    expect(beforePublication.json()).toEqual({ data: null });

    const published = await server.inject({
      headers: adminHeaders,
      method: "POST",
      payload: { expectedDraftRevision: 1 },
      url: "/v1/tenant/catalog/publish"
    });
    expect(published.statusCode, published.body).toBe(201);
    expect(published.json().data).toMatchObject({
      revision: 1,
      sourceDraftRevision: 1
    });

    const currentForAdmin = await server.inject({
      headers: adminHeaders,
      method: "GET",
      url: "/v1/tenant/catalog/current"
    });
    expect(currentForAdmin.statusCode, currentForAdmin.body).toBe(200);
    expect(currentForAdmin.json().data).toMatchObject({
      catalog: {
        products: [
          {
            content: [{ title: "Milanesa" }, { title: "Milanese" }],
            variants: [
              {
                content: [{ title: "Napolitana" }, { title: "Neapolitan" }]
              }
            ]
          }
        ]
      },
      revision: 1
    });

    const previewDraft = {
      ...draft,
      baseRevision: 1,
      products: draft.products.map((product) => ({
        ...product,
        content: product.content.map((content) =>
          content.language === "es"
            ? { ...content, title: "Milanesa especial" }
            : content
        ),
        priceCents: 130000
      }))
    };
    const savedPreview = await server.inject({
      headers: adminHeaders,
      method: "PUT",
      payload: previewDraft,
      url: "/v1/tenant/catalog/draft"
    });
    expect(savedPreview.statusCode, savedPreview.body).toBe(200);
    expect(savedPreview.json().data).toMatchObject({
      draft: {
        products: [
          {
            content: [
              { title: "Milanesa especial" },
              { title: "Milanese" }
            ],
            priceCents: 130000
          }
        ]
      },
      isDirty: true,
      revision: 2
    });

    const availability = await server.inject({
      headers: adminHeaders,
      method: "PATCH",
      payload: { expectedVersion: null, isAvailable: false },
      url: `/v1/tenant/catalog/products/${productId}/availability`
    });
    expect(availability.statusCode, availability.body).toBe(200);
    expect(availability.json()).toEqual({
      data: { isAvailable: false, version: 1 }
    });

    const publicCatalog = await server.inject({
      headers: { host: hostname },
      method: "GET",
      url: "/v1/public/catalog"
    });
    expect(publicCatalog.statusCode, publicCatalog.body).toBe(200);
    expect(publicCatalog.json().data).toMatchObject({
      availability: {
        [productId]: { isAvailable: false, version: 1 }
      },
      catalog: {
        products: [
          {
            content: [{ title: "Milanesa" }, { title: "Milanese" }]
          }
        ]
      },
      revision: 1
    });

    const resumed = await server.inject({
      headers: adminHeaders,
      method: "GET",
      url: "/v1/tenant/catalog/draft"
    });
    expect(resumed.statusCode, resumed.body).toBe(200);
    expect(resumed.json().data).toMatchObject({
      basePublishedRevision: 1,
      draft: {
        baseRevision: 1,
        products: [
          {
            content: [
              { title: "Milanesa especial" },
              { title: "Milanese" }
            ],
            priceCents: 130000
          }
        ]
      },
      isDirty: true,
      revision: 2
    });
  });
});
