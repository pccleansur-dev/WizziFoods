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
  slug: "brand-it-1",
  tenantId: "3d000000-0000-4000-8000-000000000013",
  userId: "3d000000-0000-4000-8000-000000000011"
};
const two: Fixture = {
  slug: "brand-it-2",
  tenantId: "3d000000-0000-4000-8000-000000000023",
  userId: "3d000000-0000-4000-8000-000000000021"
};
const assetId = "3d000000-0000-4000-8000-0000000000a1";

describeWithLocalStack("public brand with local Supabase", () => {
  const admin = postgres(databaseAdminUrl ?? "", { prepare: false });
  // Built on first use: the file is also read when the local stack is absent.
  const storage = () =>
    createClient(supabaseUrl ?? "", supabaseSecretKey ?? "", {
      auth: { autoRefreshToken: false, persistSession: false }
    }).storage;
  let app: NestFastifyApplication | undefined;
  let objectPath = "";

  async function cleanup() {
    for (const fixture of [one, two]) {
      await admin`delete from private.audit_events where tenant_id = ${fixture.tenantId}`;
      await admin`delete from public.tenants where id = ${fixture.tenantId}`;
      await admin`delete from auth.users where id = ${fixture.userId}`;
    }
    if (objectPath) {
      await storage().from("business-media").remove([objectPath]);
    }
  }

  const host = (fixture: Fixture) => `${fixture.slug}.plataforma.test`;
  const get = (fixture: Fixture, url: string) =>
    app!
      .getHttpAdapter()
      .getInstance()
      .inject({ headers: { host: host(fixture) }, method: "GET", url });

  async function center(png: Buffer) {
    const { data, info } = await sharp(png)
      .raw()
      .toBuffer({ resolveWithObject: true });
    const at = (x: number, y: number) =>
      Array.from(
        data.subarray((y * info.width + x) * info.channels).subarray(0, 3)
      );
    return { corner: at(2, 2), middle: at(info.width / 2, info.height / 2) };
  }

  beforeAll(async () => {
    await cleanup();
    for (const fixture of [one, two]) {
      await admin`insert into auth.users (id) values (${fixture.userId})`;
      await admin`
        insert into public.tenants (id, slug, name, status)
        values (${fixture.tenantId}, ${fixture.slug}, ${`Marca ${fixture.slug}`}, 'active')`;
      await admin`
        insert into public.tenant_memberships (tenant_id, user_id, role)
        values (${fixture.tenantId}, ${fixture.userId}, 'admin')`;
      await admin`
        insert into public.tenant_domains (tenant_id, hostname, kind, status, is_primary)
        values (${fixture.tenantId}, ${host(fixture)}, 'platform_subdomain', 'active', true)`;
    }
    const [location] = await admin<{ id: string }[]>`
      select id from public.locations where tenant_id = ${one.tenantId}`;
    objectPath = `tenants/${one.tenantId}/locations/${location!.id}/business-profile/logo/${assetId}.png`;
    // A wide red logo, stored where the media worker stores the real ones.
    const logo = await sharp({
      create: { background: "#FF0000", channels: 3, height: 100, width: 400 }
    })
      .png()
      .toBuffer();
    const upload = await storage()
      .from("business-media")
      .upload(objectPath, logo, { contentType: "image/png", upsert: true });
    expect(upload.error).toBeNull();
    await admin`
      insert into private.business_media_assets (
        id, tenant_id, location_id, kind, status, content_type, source_size_bytes,
        stored_size_bytes, width, height, sha256, object_path, created_by
      ) values (
        ${assetId}, ${one.tenantId}, ${location!.id}, 'logo', 'ready', 'image/png',
        ${logo.length}, ${logo.length}, 400, 100, ${"cd".repeat(32)}, ${objectPath}, ${one.userId})`;
    await admin`
      insert into private.business_profile_drafts (
        tenant_id, location_id, display_name, primary_color, secondary_color,
        logo_asset_id, updated_by
      ) values (
        ${one.tenantId}, ${location!.id}, 'La Parrilla', '#112233', '#EEEEEE',
        ${assetId}, ${one.userId})`;

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

  it("tells the public the name, the colors and a version of the logo, never where it is", async () => {
    const response = await get(one, "/v1/public/brand");
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({
      backgroundColor: "#EEEEEE",
      logoVersion: "cdcdcdcdcdcdcdcd",
      name: "La Parrilla",
      primaryColor: "#112233"
    });
    expect(response.body).not.toContain("tenants/");
  });

  it("makes the icon out of the logo the restaurant chose", async () => {
    const response = await get(one, "/v1/public/brand/icon?size=192");
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("image/png");
    expect(response.headers["cache-control"]).toContain("max-age");
    const png = response.rawPayload;
    const meta = await sharp(png).metadata();
    expect([meta.width, meta.height]).toEqual([192, 192]);
    const { corner, middle } = await center(png);
    expect(corner).toEqual([0xee, 0xee, 0xee]);
    expect(middle).toEqual([0xff, 0, 0]);
    const maskable = await get(
      one,
      "/v1/public/brand/icon?size=512&maskable=1"
    );
    expect((await sharp(maskable.rawPayload).metadata()).width).toBe(512);
  });

  it("gives another restaurant its own icon and never this logo", async () => {
    const response = await get(two, "/v1/public/brand/icon?size=192");
    expect(response.statusCode).toBe(200);
    const { middle } = await center(response.rawPayload);
    expect(middle).not.toEqual([0xff, 0, 0]);
    const brand = await get(two, "/v1/public/brand");
    expect(brand.json().data.name).toBe("Marca brand-it-2");
    expect(brand.json().data.logoVersion).toBeNull();
  });

  it("refuses an unknown host and a size the app does not use", async () => {
    const unknown = await app!
      .getHttpAdapter()
      .getInstance()
      .inject({
        headers: { host: "nadie.plataforma.test" },
        method: "GET",
        url: "/v1/public/brand/icon?size=192"
      });
    expect(unknown.statusCode).toBe(404);
    expect((await get(one, "/v1/public/brand/icon?size=4096")).statusCode).toBe(
      400
    );
    expect(
      (await get(one, "/v1/public/brand/icon?size=192&maskable=2")).statusCode
    ).toBe(400);
  });
});
