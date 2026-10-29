import { createClient } from "@supabase/supabase-js";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication
} from "@nestjs/platform-fastify";
import type { ApiRuntimeConfig } from "@platform/config";
import postgres from "postgres";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../app.module.js";

const databaseUrl = process.env.DATABASE_URL;
const databaseAdminUrl = process.env.DATABASE_ADMIN_URL;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
const hasLocalStack =
  databaseUrl && databaseAdminUrl && supabaseUrl && supabaseSecretKey;
const describeWithLocalStack = hasLocalStack ? describe : describe.skip;

type Fixture = { slug: string; tenantId: string; userId: string };
const one: Fixture = {
  slug: "catimg-it-1",
  tenantId: "3e000000-0000-4000-8000-000000000013",
  userId: "3e000000-0000-4000-8000-000000000011"
};
const two: Fixture = {
  slug: "catimg-it-2",
  tenantId: "3e000000-0000-4000-8000-000000000023",
  userId: "3e000000-0000-4000-8000-000000000021"
};
const publishedAsset = "3e000000-0000-4000-8000-0000000000a1";
const draftOnlyAsset = "3e000000-0000-4000-8000-0000000000a2";
const productId = "3e000000-0000-4000-8000-0000000000b1";
const otherProductId = "3e000000-0000-4000-8000-0000000000b2";

describeWithLocalStack("public product photos with local Supabase", () => {
  const admin = postgres(databaseAdminUrl ?? "", { prepare: false });
  const storage = () =>
    createClient(supabaseUrl ?? "", supabaseSecretKey ?? "", {
      auth: { autoRefreshToken: false, persistSession: false }
    }).storage;
  let app: NestFastifyApplication | undefined;
  const objectPaths: string[] = [];

  async function cleanup() {
    for (const fixture of [one, two]) {
      await admin`delete from private.published_catalogs where tenant_id = ${fixture.tenantId}`;
      await admin`delete from private.audit_events where tenant_id = ${fixture.tenantId}`;
      await admin`delete from public.tenants where id = ${fixture.tenantId}`;
      await admin`delete from auth.users where id = ${fixture.userId}`;
    }
    if (objectPaths.length > 0) {
      await storage().from("business-media").remove(objectPaths);
    }
  }

  const host = (fixture: Fixture) => `${fixture.slug}.plataforma.test`;
  const get = (fixture: Fixture, url: string) =>
    app!
      .getHttpAdapter()
      .getInstance()
      .inject({ headers: { host: host(fixture) }, method: "GET", url });

  beforeAll(async () => {
    await cleanup();
    for (const fixture of [one, two]) {
      await admin`insert into auth.users (id) values (${fixture.userId})`;
      await admin`
        insert into public.tenants (id, slug, name, status)
        values (${fixture.tenantId}, ${fixture.slug}, ${`Foto ${fixture.slug}`}, 'active')`;
      await admin`
        insert into public.tenant_memberships (tenant_id, user_id, role)
        values (${fixture.tenantId}, ${fixture.userId}, 'admin')`;
      await admin`
        insert into public.tenant_domains (tenant_id, hostname, kind, status, is_primary)
        values (${fixture.tenantId}, ${host(fixture)}, 'platform_subdomain', 'active', true)`;
    }
    const [location] = await admin<{ id: string }[]>`
      select id from public.locations where tenant_id = ${one.tenantId}`;
    const photo = await sharp({
      create: { background: "#00AA00", channels: 3, height: 40, width: 60 }
    })
      .png()
      .toBuffer();
    for (const [index, id] of [publishedAsset, draftOnlyAsset].entries()) {
      const objectPath = `tenants/${one.tenantId}/locations/${location!.id}/business-profile/product/${id}.png`;
      objectPaths.push(objectPath);
      const upload = await storage()
        .from("business-media")
        .upload(objectPath, photo, { contentType: "image/png", upsert: true });
      expect(upload.error).toBeNull();
      await admin`
        insert into private.business_media_assets (
          id, tenant_id, location_id, kind, status, content_type, source_size_bytes,
          stored_size_bytes, width, height, sha256, object_path, created_by
        ) values (
          ${id}, ${one.tenantId}, ${location!.id}, 'product', 'ready', 'image/png',
          ${photo.length}, ${photo.length}, 60, 40, ${String(index + 1).repeat(64)},
          ${objectPath}, ${one.userId})`;
    }
    const snapshot = {
      categories: [],
      products: [
        { id: productId, imageAssetId: publishedAsset },
        { id: otherProductId, imageAssetId: null }
      ],
      sectors: []
    };
    await admin`
      insert into private.published_catalogs (
        tenant_id, location_id, revision, source_draft_revision, snapshot, published_by
      ) values (
        ${one.tenantId}, ${location!.id}, 1, 1, ${admin.json(snapshot)}, ${one.userId})`;

    const config: ApiRuntimeConfig = {
      adminInviteRedirectUrl: "https://app.example.test/auth/callback",
      databaseUrl: databaseUrl ?? "",
      environment: "test",
      logLevel: "error",
      metricsPort: 9464,
      paymentSecretKey: null,
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
  }, 90_000);

  afterAll(async () => {
    await app?.close();
    await cleanup();
    await admin.end();
  });

  it("serves the photo the published menu points at, cacheable, for its own host", async () => {
    const response = await get(
      one,
      `/v1/public/catalog/images/${publishedAsset}`
    );
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("image/png");
    expect(response.headers["cache-control"]).toContain("max-age");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    const meta = await sharp(response.rawPayload).metadata();
    expect([meta.width, meta.height]).toEqual([60, 40]);
  });

  it("answers 404 for a photo that only exists in a draft or in the bucket", async () => {
    const response = await get(
      one,
      `/v1/public/catalog/images/${draftOnlyAsset}`
    );
    expect(response.statusCode).toBe(404);
  });

  it("never gives one restaurant's photo to the host of another", async () => {
    const response = await get(
      two,
      `/v1/public/catalog/images/${publishedAsset}`
    );
    expect(response.statusCode).toBe(404);
  });

  it("refuses a malformed id and an unknown host", async () => {
    expect(
      (await get(one, "/v1/public/catalog/images/not-a-uuid")).statusCode
    ).toBe(404);
    const unknown = await app!
      .getHttpAdapter()
      .getInstance()
      .inject({
        headers: { host: "nadie.plataforma.test" },
        method: "GET",
        url: `/v1/public/catalog/images/${publishedAsset}`
      });
    expect(unknown.statusCode).toBe(404);
  });
});
