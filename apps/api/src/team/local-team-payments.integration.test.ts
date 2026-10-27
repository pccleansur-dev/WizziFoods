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

const one: Fixture = {
  hostname: "team-one.plataforma.test",
  sessionId: "fd000000-0000-4000-8000-000000000012",
  slug: "team-one",
  tenantId: "fd000000-0000-4000-8000-000000000013",
  userId: "fd000000-0000-4000-8000-000000000011"
};
const two: Fixture = {
  hostname: "team-two.plataforma.test",
  sessionId: "fd000000-0000-4000-8000-000000000022",
  slug: "team-two",
  tenantId: "fd000000-0000-4000-8000-000000000023",
  userId: "fd000000-0000-4000-8000-000000000021"
};

const salon = "fd100000-0000-4000-8000-000000000001";
const credential = "APP_USR-0123456789-integration-secret";
const waiterPin = "482913";
const resetPin = "735104";
const paymentKey = Buffer.alloc(32, 5);

describeWithLocalStack("team and payments with local Supabase", () => {
  const admin = postgres(databaseAdminUrl ?? "", { prepare: false });
  let app: NestFastifyApplication | undefined;
  let privateJwk: JWK;
  const bodies: string[] = [];

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
    for (const fixture of [one, two]) {
      await admin`insert into auth.users (id) values (${fixture.userId})`;
      await admin`
        insert into auth.sessions (id, user_id, aal, created_at, updated_at)
        values (${fixture.sessionId}, ${fixture.userId}, 'aal2', now(), now())
      `;
      await admin`
        insert into public.tenants (id, slug, name, status)
        values (${fixture.tenantId}, ${fixture.slug}, 'Team', 'active')
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
    await admin`
      insert into private.floor_plans (tenant_id, location_id)
      select tenant_id, id from public.locations where tenant_id = ${one.tenantId}
    `;
    await admin`
      insert into private.floor_sectors (tenant_id, location_id, id, name, position)
      select tenant_id, id, ${salon}::uuid, 'Salón', 0
      from public.locations where tenant_id = ${one.tenantId}
    `;

    const config: ApiRuntimeConfig = {
      adminInviteRedirectUrl: "https://app.example.test/auth/callback",
      databaseUrl: databaseUrl ?? "",
      environment: "test",
      logLevel: "error",
      metricsPort: 9464,
      paymentSecretKey: paymentKey,
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

  async function call(
    fixture: Fixture,
    method: "DELETE" | "GET" | "PATCH" | "POST" | "PUT",
    url: string,
    payload?: unknown,
    host?: string
  ) {
    const response = await app!
      .getHttpAdapter()
      .getInstance()
      .inject({
        headers: await headers(fixture, host),
        method,
        payload: payload as never,
        url
      });
    bodies.push(response.body);
    return response;
  }

  const team = (
    fixture: Fixture,
    method: "GET" | "PATCH" | "POST" | "PUT",
    path = "",
    payload?: unknown,
    host?: string
  ) => call(fixture, method, `/v1/tenant/team${path}`, payload, host);
  const pay = (
    fixture: Fixture,
    method: "DELETE" | "GET" | "PUT",
    path = "",
    payload?: unknown
  ) => call(fixture, method, `/v1/tenant/payment-methods${path}`, payload);

  const waiter = {
    displayName: "Ana",
    pin: waiterPin,
    role: "waiter",
    sectorIds: [salon],
    username: "ana"
  };

  it("requires authentication and an administrator of the resolved host", async () => {
    const anonymous = await app!
      .getHttpAdapter()
      .getInstance()
      .inject({
        headers: { host: one.hostname },
        method: "GET",
        url: "/v1/tenant/team"
      });
    expect(anonymous.statusCode).toBe(401);
    // Tenant one's administrator on tenant two's domain gets nothing.
    const crossed = await team(one, "GET", "", undefined, two.hostname);
    expect([403, 404]).toContain(crossed.statusCode);
    expect(crossed.body).not.toContain("ana");
  });

  it("creates, edits, deactivates and isolates team members", async () => {
    expect((await team(one, "GET")).json()).toEqual({ data: [] });

    const injected = await team(one, "POST", "", {
      ...waiter,
      tenantId: two.tenantId
    });
    expect(injected.statusCode).toBe(400);

    const created = await team(one, "POST", "", waiter);
    expect(created.statusCode).toBe(201);
    const ana = created.json().data as { id: string; sectorIds: string[] };
    expect(ana.sectorIds).toEqual([salon]);
    expect((await team(one, "POST", "", waiter)).statusCode).toBe(409);

    // The new account really signs in (T06), then loses access when deactivated.
    const login = () =>
      app!
        .getHttpAdapter()
        .getInstance()
        .inject({
          method: "POST",
          payload: { pin: waiterPin, username: "ana" },
          url: `/v1/tenants/${one.slug}/staff-sessions`
        });
    const session = await login();
    expect(session.statusCode).toBe(201);
    const accessToken = session.json().data.accessToken as string;
    const current = () =>
      app!
        .getHttpAdapter()
        .getInstance()
        .inject({
          headers: { authorization: `Bearer ${accessToken}` },
          method: "GET",
          url: "/v1/staff-sessions/current"
        });
    expect((await current()).statusCode).toBe(200);

    const sectors = await team(one, "PATCH", `/${ana.id}`, {
      displayName: "Ana M.",
      role: "waiter",
      sectorIds: []
    });
    expect(sectors.json().data).toMatchObject({
      displayName: "Ana M.",
      sectorIds: []
    });
    expect(
      (
        await team(one, "PATCH", `/${ana.id}`, {
          displayName: "Ana",
          role: "kitchen",
          sectorIds: [salon]
        })
      ).statusCode
    ).toBe(400);

    // Tenant two can neither see nor change tenant one's member.
    expect((await team(two, "GET")).json()).toEqual({ data: [] });
    expect(
      (await team(two, "PUT", `/${ana.id}/active`, { active: false }))
        .statusCode
    ).toBe(404);
    expect(
      (
        await team(two, "PATCH", `/${ana.id}`, {
          displayName: "x",
          role: "waiter",
          sectorIds: []
        })
      ).statusCode
    ).toBe(404);

    // A sector of another business cannot be assigned.
    const foreign = await team(two, "POST", "", {
      ...waiter,
      username: "eve"
    });
    expect(foreign.statusCode).toBe(422);

    const off = await team(one, "PUT", `/${ana.id}/active`, { active: false });
    expect(off.json().data.isActive).toBe(false);
    expect((await current()).statusCode).toBe(401);
    expect((await login()).statusCode).toBe(401);

    const on = await team(one, "PUT", `/${ana.id}/active`, { active: true });
    expect(on.json().data.isActive).toBe(true);
    expect(
      (await team(one, "PUT", `/${ana.id}/pin`, { pin: resetPin })).statusCode
    ).toBe(204);
    expect((await login()).statusCode).toBe(401);
    const relogin = await app!
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "POST",
        payload: { pin: resetPin, username: "ana" },
        url: `/v1/tenants/${one.slug}/staff-sessions`
      });
    expect(relogin.statusCode).toBe(201);
  });

  it("keeps at least one active manager (T06 rule)", async () => {
    const boss = await team(one, "POST", "", {
      displayName: "Jefe",
      pin: "111222",
      role: "manager",
      sectorIds: [],
      username: "jefe"
    });
    const bossId = boss.json().data.id as string;
    const blocked = await team(one, "PUT", `/${bossId}/active`, {
      active: false
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe("TEAM_LAST_MANAGER");
    expect(
      (
        await team(one, "PATCH", `/${bossId}`, {
          displayName: "Jefe",
          role: "waiter",
          sectorIds: []
        })
      ).statusCode
    ).toBe(409);

    const second = await team(one, "POST", "", {
      displayName: "Jefa",
      pin: "333444",
      role: "manager",
      sectorIds: [],
      username: "jefa"
    });
    expect(second.statusCode).toBe(201);
    expect(
      (await team(one, "PUT", `/${bossId}/active`, { active: false }))
        .statusCode
    ).toBe(200);
  });

  it("enforces the payment method rules in the database", async () => {
    const initial = (await pay(one, "GET")).json().data as {
      enabled: boolean;
      method: string;
    }[];
    expect(initial.filter((method) => method.enabled)).toEqual([
      expect.objectContaining({ method: "cash" })
    ]);

    const last = await pay(one, "PUT", "/cash", { enabled: false });
    expect(last.statusCode).toBe(409);
    expect(last.json().error.code).toBe("PAYMENT_LAST_METHOD");

    const provider = await pay(one, "PUT", "/mercado_pago", { enabled: true });
    expect(provider.statusCode).toBe(422);

    expect(
      (await pay(one, "PUT", "/debit_card", { enabled: true })).statusCode
    ).toBe(200);
    expect(
      (await pay(one, "PUT", "/cash", { enabled: false })).statusCode
    ).toBe(200);
    expect(
      (await pay(one, "PUT", "/debit_card", { enabled: false })).statusCode
    ).toBe(409);

    // Tenant two is untouched.
    const other = (await pay(two, "GET")).json().data as {
      enabled: boolean;
      method: string;
    }[];
    expect(other.find((method) => method.method === "cash")?.enabled).toBe(
      true
    );
    expect(
      (
        await pay(one, "PUT", "/cash", {
          enabled: true,
          tenantId: two.tenantId
        })
      ).statusCode
    ).toBe(400);
  });

  it("stores provider credentials sealed and never returns them", async () => {
    expect(
      (await pay(one, "PUT", "/cash/credential", { secret: credential }))
        .statusCode
    ).toBe(400);
    const config = await pay(one, "PUT", "/mercado_pago", {
      enabled: false,
      publicConfig: { publicKey: "APP_USR-publickey-1234" }
    });
    expect(config.statusCode).toBe(200);
    const stored = await pay(one, "PUT", "/mercado_pago/credential", {
      secret: credential
    });
    expect(stored.statusCode).toBe(200);
    expect(
      (stored.json().data as { configured: boolean; method: string }[]).find(
        (method) => method.method === "mercado_pago"
      )?.configured
    ).toBe(true);

    const rows = await admin<{ ciphertext: Buffer; key_version: number }[]>`
      select ciphertext, key_version from private.payment_method_secrets
      where tenant_id = ${one.tenantId}
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.ciphertext.includes(Buffer.from(credential))).toBe(false);
    expect(rows[0]!.key_version).toBe(1);

    expect(
      (await pay(one, "PUT", "/mercado_pago", { enabled: true })).statusCode
    ).toBe(200);
    const cleared = await pay(one, "DELETE", "/mercado_pago/credential");
    expect(cleared.statusCode).toBe(200);
    expect(
      (cleared.json().data as { enabled: boolean; method: string }[]).find(
        (method) => method.method === "mercado_pago"
      )?.enabled
    ).toBe(false);
  });

  it("audits changes without PINs, hashes, usernames or credentials", async () => {
    const events = await admin<
      { action: string; correlation_id: string; reason: string }[]
    >`
      select action, reason, correlation_id from private.audit_events
      where tenant_id = ${one.tenantId}
    `;
    const actions = new Set(events.map((event) => event.action));
    for (const action of [
      "staff.created",
      "staff.deactivated",
      "staff.activated",
      "staff.sectors_changed",
      "staff.credential_reset",
      "payment_method.disabled",
      "payment_method.enabled",
      "payment_method.secret_stored",
      "payment_method.secret_cleared"
    ]) {
      expect(actions.has(action)).toBe(true);
    }
    const audit = JSON.stringify(events);
    for (const forbidden of [
      waiterPin,
      resetPin,
      credential,
      "scrypt",
      "ana",
      "jefe"
    ]) {
      expect(audit).not.toContain(forbidden);
    }
  });

  it("never returned a PIN, hash or credential in any response", () => {
    const all = bodies.join("\n");
    for (const forbidden of [
      waiterPin,
      resetPin,
      credential,
      "scrypt-v1",
      "pin_hash",
      "ciphertext"
    ]) {
      expect(all).not.toContain(forbidden);
    }
  });
});
