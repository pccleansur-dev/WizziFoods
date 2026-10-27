import { createECDH, createHash, randomBytes } from "node:crypto";

import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication
} from "@nestjs/platform-fastify";
import type { ApiRuntimeConfig } from "@platform/config";
import { signWebhookBody } from "@platform/integrations";
import type { InjectOptions } from "fastify";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../app.module.js";
import { hashStaffPin } from "../staff-auth/pin-credential.js";

const databaseUrl = process.env.DATABASE_URL;
const databaseAdminUrl = process.env.DATABASE_ADMIN_URL;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
const hasLocalStack =
  databaseUrl && databaseAdminUrl && supabaseUrl && supabaseSecretKey;
const describeWithLocalStack = hasLocalStack ? describe : describe.skip;

const pepper = "test-pepper-with-at-least-32-characters";
const pin = "135790";
const appSecret = "it-whatsapp-app-secret-16+";
const verifyToken = "it-whatsapp-verify-token-16+";
const accessToken = "EAAG-integration-token-9876543210-ABC"; // secret-scan: allow

type Fixture = { slug: string; tenantId: string; userId: string };
const one: Fixture = {
  slug: "msg-it-1",
  tenantId: "3b000000-0000-4000-8000-000000000013",
  userId: "3b000000-0000-4000-8000-000000000011"
};
const two: Fixture = {
  slug: "msg-it-2",
  tenantId: "3b000000-0000-4000-8000-000000000023",
  userId: "3b000000-0000-4000-8000-000000000021"
};

const vapid = createECDH("prime256v1");
vapid.generateKeys();
const vapidPublicKey = vapid.getPublicKey().toString("base64url");
const browserKeys = (n: number) => ({
  auth: "B".repeat(22),
  endpoint: `https://push.example.com/send/api-${n}`,
  p256dh: "A".repeat(87)
});

const hex = (value: string) => createHash("sha256").update(value).digest("hex");

describeWithLocalStack("messaging API with local Supabase", () => {
  const admin = postgres(databaseAdminUrl ?? "", { prepare: false });
  let app: NestFastifyApplication | undefined;
  let locationOne = "";
  let locationTwo = "";
  const sessions = new Map<string, string>();
  const accounts: string[] = [];
  let counter = 1;
  const uuid = () =>
    `3b500000-0000-4000-8000-${String(counter++).padStart(12, "0")}`;

  async function cleanup() {
    for (const fixture of [one, two]) {
      const tenant = fixture.tenantId;
      await admin.begin(async (tx) => {
        await tx`set local session_replication_role = replica`;
        await tx`delete from private.messaging_events where tenant_id = ${tenant}`;
        await tx`delete from private.push_subscriptions where tenant_id = ${tenant}`;
        await tx`delete from private.push_settings where tenant_id = ${tenant}`;
        await tx`delete from private.messaging_outbox where tenant_id = ${tenant}`;
        await tx`delete from private.messaging_automations where tenant_id = ${tenant}`;
        await tx`delete from private.whatsapp_templates where tenant_id = ${tenant}`;
        await tx`delete from private.whatsapp_connections where tenant_id = ${tenant}`;
        await tx`delete from private.loyalty_visits where tenant_id = ${tenant}`;
        await tx`delete from private.loyalty_rewards where tenant_id = ${tenant}`;
        await tx`delete from private.diner_birthdays where tenant_id = ${tenant}`;
        await tx`delete from private.loyalty_settings where tenant_id = ${tenant}`;
        await tx`delete from private.diner_session_links where tenant_id = ${tenant}`;
        await tx`delete from private.diner_consent_events where tenant_id = ${tenant}`;
        await tx`delete from private.diner_profile_links where tenant_id = ${tenant}`;
        await tx`delete from private.diner_profiles where tenant_id = ${tenant}`;
        await tx`delete from private.diner_sessions where tenant_id = ${tenant}`;
        await tx`delete from private.diner_login_exchanges where tenant_id = ${tenant}`;
        await tx`delete from private.cashier_requests where tenant_id = ${tenant}`;
        await tx`delete from private.account_receipts where tenant_id = ${tenant}`;
        await tx`delete from private.receipt_counters where tenant_id = ${tenant}`;
        await tx`delete from private.table_group_events where tenant_id = ${tenant}`;
        await tx`delete from private.table_sessions where tenant_id = ${tenant}`;
      });
      await admin`delete from private.waiter_commands where tenant_id = ${tenant}`;
      await admin`delete from private.audit_events where tenant_id = ${tenant}`;
      await admin`delete from public.tenants where id = ${tenant}`;
      await admin`delete from auth.users where id = ${fixture.userId}`;
    }
    await admin.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`delete from private.diner_accounts where id = any(${accounts}::uuid[])`;
      await tx`delete from private.messaging_webhook_events where event_key like 'status:wamid.IT%' or event_key like 'message:wamid.IT%'`;
    });
  }

  async function createStaff(
    fixture: Fixture,
    locationId: string,
    username: string,
    role: string
  ) {
    const hash = await hashStaffPin(pin, pepper);
    await admin`
      select private.create_staff_member(
        ${fixture.tenantId}::uuid, ${locationId}::uuid, ${fixture.userId}::uuid,
        ${username}, ${username}, ${role}, ${hash}, '{}'::uuid[])`;
  }

  async function login(fixture: Fixture, username: string) {
    const response = await app!
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "POST",
        payload: { pin, username },
        url: `/v1/tenants/${fixture.slug}/staff-sessions`
      });
    expect(response.statusCode).toBe(201);
    sessions.set(username, response.json().data.accessToken);
  }

  async function staff(
    username: string,
    method: "DELETE" | "GET" | "POST" | "PUT",
    url: string,
    payload?: unknown
  ) {
    const options: InjectOptions = {
      headers: { authorization: `Bearer ${sessions.get(username)}` },
      method,
      url
    };
    if (payload !== undefined) options.payload = payload as object;
    const response = await app!.getHttpAdapter().getInstance().inject(options);
    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      body: response.json() as Record<string, any>,
      status: response.statusCode,
      text: response.body
    };
  }

  /** A diner session for the last account created, as the diner cookie would carry it. */
  async function dinerToken(tenantId: string) {
    const token = randomBytes(32).toString("base64url");
    const [account] = await admin<{ account_id: string }[]>`
      select account_id from private.diner_profile_links
      where tenant_id = ${tenantId} order by created_at desc limit 1`;
    await admin`
      insert into private.diner_sessions (token_hash, account_id, tenant_id, expires_at)
      values (${createHash("sha256").update(token).digest()}, ${account!.account_id},
        ${tenantId}, now() + interval '1 day')`;
    return token;
  }

  async function dinerCall(
    fixture: Fixture,
    method: "GET" | "POST",
    url: string,
    token: string | null,
    payload?: unknown
  ) {
    const options: InjectOptions = {
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        host: `${fixture.slug}.plataforma.test`
      },
      method,
      url
    };
    if (payload !== undefined) options.payload = payload as object;
    const response = await app!.getHttpAdapter().getInstance().inject(options);
    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      body: response.json() as Record<string, any>,
      status: response.statusCode
    };
  }

  async function webhook(body: unknown, signature?: string) {
    const raw = JSON.stringify(body);
    const response = await app!
      .getHttpAdapter()
      .getInstance()
      .inject({
        headers: {
          "content-type": "application/json",
          "x-hub-signature-256": signature ?? signWebhookBody(appSecret, raw)
        },
        method: "POST",
        payload: raw,
        url: "/v1/webhooks/whatsapp"
      });
    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      body: response.json() as Record<string, any>,
      status: response.statusCode
    };
  }

  async function newDiner(tenantId: string, name: string, phone: string) {
    const [account] = await admin<{ id: string }[]>`
      select private.upsert_diner_account(${hex(name + Date.now())}, ${name + "@example.com"}) as id`;
    accounts.push(account!.id);
    await admin`select private.save_diner_profile(${tenantId}::uuid, ${account!.id}::uuid, ${name}, ${phone})`;
    for (const kind of ["whatsapp_verified", "marketing"]) {
      await admin`select private.record_diner_consent(
        ${tenantId}::uuid, ${account!.id}::uuid, ${uuid()}::uuid, ${kind}::text, 'granted', 1, 'profile')`;
    }
    const [profile] = await admin<{ id: string }[]>`
      select private.diner_profile_id_of(${tenantId}::uuid, ${account!.id}::uuid) as id`;
    return profile!.id;
  }

  beforeAll(async () => {
    await cleanup();
    for (const fixture of [one, two]) {
      await admin`insert into auth.users (id) values (${fixture.userId})`;
      await admin`
        insert into public.tenants (id, slug, name, status)
        values (${fixture.tenantId}, ${fixture.slug}, 'Messaging IT', 'active')`;
      await admin`
        insert into public.tenant_memberships (tenant_id, user_id, role)
        values (${fixture.tenantId}, ${fixture.userId}, 'admin')`;
      await admin`
        insert into public.tenant_domains (tenant_id, hostname, kind, status, is_primary)
        values (${fixture.tenantId}, ${`${fixture.slug}.plataforma.test`}, 'platform_subdomain', 'active', true)`;
    }
    const [first] = await admin<
      { id: string }[]
    >`select id from public.locations where tenant_id = ${one.tenantId}`;
    const [second] = await admin<
      { id: string }[]
    >`select id from public.locations where tenant_id = ${two.tenantId}`;
    locationOne = first!.id;
    locationTwo = second!.id;
    await createStaff(one, locationOne, "ana", "waiter");
    await createStaff(one, locationOne, "marta", "manager");
    await createStaff(two, locationTwo, "otra", "manager");

    const config: ApiRuntimeConfig = {
      adminInviteRedirectUrl: "https://app.example.test/auth/callback",
      databaseUrl: databaseUrl ?? "",
      environment: "test",
      logLevel: "error",
      metricsPort: 9464,
      paymentSecretKey: Buffer.alloc(32, 3),
      platformBaseDomain: "plataforma.test",
      platformTenantHostTemplate: "{slug}.{domain}",
      port: 3001,
      staffPinPepper: pepper,
      supabaseSecretKey: supabaseSecretKey ?? "",
      supabaseUrl: supabaseUrl ?? "",
      webPush: {
        mode: "simulated",
        privateKey: null,
        publicKey: vapidPublicKey,
        subject: "mailto:soporte@plataforma.test"
      },
      whatsapp: {
        appSecret,
        graphVersion: "v21.0",
        mode: "simulated",
        verifyToken
      }
    };
    app = await NestFactory.create<NestFastifyApplication>(
      AppModule.register(config),
      new FastifyAdapter(),
      { logger: false, rawBody: true }
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    for (const name of ["ana", "marta"]) await login(one, name);
    await login(two, "otra");
  }, 90_000);

  afterAll(async () => {
    await app?.close();
    await cleanup();
    await admin.end();
  });

  it("is the Encargado's: a waiter is refused and an anonymous caller too", async () => {
    expect((await staff("ana", "GET", "/v1/staff/messaging")).status).toBe(403);
    const anonymous = await app!
      .getHttpAdapter()
      .getInstance()
      .inject({ method: "GET", url: "/v1/staff/messaging" });
    expect(anonymous.statusCode).toBe(401);
    const manager = await staff("marta", "GET", "/v1/staff/messaging");
    expect(manager.status).toBe(200);
    expect(manager.body.data.connection).toBeNull();
    expect(manager.body.data.automations).toHaveLength(8);
  });

  it("seals the token, keeps it out of every response and isolates each restaurant", async () => {
    const connected = await staff(
      "marta",
      "PUT",
      "/v1/staff/messaging/connection",
      {
        accessToken,
        displayPhone: "+5491100000007",
        phoneNumberId: "50000000001",
        wabaId: "60000000001"
      }
    );
    expect(connected.status).toBe(200);
    expect(connected.body.data.connection.phoneNumberId).toBe("50000000001");
    expect(connected.body.data.templates.length).toBeGreaterThan(0);
    expect(connected.body.data.connection.sendingEnabled).toBe(false);
    expect(connected.text).not.toContain(accessToken);
    expect(
      (await staff("marta", "GET", "/v1/staff/messaging")).text
    ).not.toMatch(/ciphertext|accessToken/u);

    const [stored] = await admin<{ ciphertext: Buffer }[]>`
      select ciphertext from private.whatsapp_connections where tenant_id = ${one.tenantId}`;
    expect(stored!.ciphertext.includes(Buffer.from(accessToken))).toBe(false);

    const other = await staff("otra", "GET", "/v1/staff/messaging");
    expect(other.body.data.connection).toBeNull();
    expect(other.body.data.templates).toEqual([]);

    const taken = await staff("otra", "PUT", "/v1/staff/messaging/connection", {
      accessToken,
      phoneNumberId: "50000000001",
      wabaId: "60000000002"
    });
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe("WHATSAPP_NUMBER_IN_USE");

    const bad = await staff("marta", "PUT", "/v1/staff/messaging/connection", {
      accessToken,
      phoneNumberId: "50000000001",
      tenantId: one.tenantId,
      wabaId: "60000000001"
    });
    expect(bad.status).toBe(400);
  });

  it("approves an automation once and confirms a one-off event before anything is queued", async () => {
    const overview = (await staff("marta", "GET", "/v1/staff/messaging")).body
      .data;
    const operational = overview.templates.find(
      (t: { category: string; approvalStatus: string }) =>
        t.category === "operational" && t.approvalStatus === "approved"
    );
    const pending = overview.templates.find(
      (t: { approvalStatus: string }) => t.approvalStatus === "pending"
    );
    const refused = await staff(
      "marta",
      "PUT",
      "/v1/staff/messaging/automations",
      {
        kind: "birthday",
        templateId: pending.id
      }
    );
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("TEMPLATE_NOT_APPROVED");

    const saved = await staff(
      "marta",
      "PUT",
      "/v1/staff/messaging/automations",
      {
        kind: "reward_earned",
        templateId: operational.id
      }
    );
    const automation = saved.body.data.automations.find(
      (a: { kind: string }) => a.kind === "reward_earned"
    );
    expect(automation.status).toBe("pending_approval");
    const approved = await staff(
      "marta",
      "POST",
      `/v1/staff/messaging/automations/${automation.id}/decision`,
      { decision: "approve" }
    );
    expect(
      approved.body.data.automations.find(
        (a: { kind: string }) => a.kind === "reward_earned"
      ).status
    ).toBe("approved");

    const profile = await newDiner(one.tenantId, "Lucia", "+5491155550001");
    const commandId = uuid();
    const proposed = await staff(
      "marta",
      "POST",
      "/v1/staff/messaging/one-off-events",
      {
        commandId,
        profileIds: [profile],
        templateId: operational.id,
        variables: ["Lucia"]
      }
    );
    expect(proposed.body.data).toEqual({ batchId: commandId, recipients: 1 });
    const [queuedRow] = await admin<{ queued: number }[]>`
      select count(*)::int as queued from private.messaging_outbox
      where tenant_id = ${one.tenantId} and batch_id = ${commandId} and status = 'queued'`;
    expect(queuedRow!.queued).toBe(0);
    const first = await staff(
      "marta",
      "POST",
      `/v1/staff/messaging/one-off-events/${commandId}/decision`,
      { decision: "confirm" }
    );
    const again = await staff(
      "marta",
      "POST",
      `/v1/staff/messaging/one-off-events/${commandId}/decision`,
      { decision: "confirm" }
    );
    expect(first.body.data.changed).toBe(1);
    expect(again.body.data.changed).toBe(0);
    const foreign = await staff(
      "otra",
      "POST",
      `/v1/staff/messaging/one-off-events/${commandId}/decision`,
      { decision: "cancel" }
    );
    expect(foreign.status).toBe(404);
    const events = await staff("marta", "GET", "/v1/staff/messaging/events");
    expect(events.body.data[0]).toMatchObject({
      displayName: "Lucia",
      kind: "queued"
    });
    expect(events.text).not.toMatch(/@|accountId|5491155550001/u);
  });

  it("answers Meta's handshake only for the right verify token", async () => {
    const instance = app!.getHttpAdapter().getInstance();
    const ok = await instance.inject({
      method: "GET",
      url: `/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(verifyToken)}&hub.challenge=12345`
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toBe("12345");
    const wrong = await instance.inject({
      method: "GET",
      url: "/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=12345"
    });
    expect(wrong.statusCode).toBe(403);
  });

  it("refuses an unsigned or tampered notification and applies a signed one once", async () => {
    const profile = await newDiner(one.tenantId, "Mateo", "+5491155550002");
    const commandId = uuid();
    const [template] = await admin<{ id: string }[]>`
      select id from private.whatsapp_templates
      where tenant_id = ${one.tenantId} and category = 'promotional' and approval_status = 'approved' limit 1`;
    await staff("marta", "POST", "/v1/staff/messaging/one-off-events", {
      commandId,
      profileIds: [profile],
      templateId: template!.id,
      variables: ["Mateo"]
    });
    await staff(
      "marta",
      "POST",
      `/v1/staff/messaging/one-off-events/${commandId}/decision`,
      { decision: "confirm" }
    );
    await admin`
      update private.messaging_outbox set status = 'sent', provider_message_id = 'wamid.IT0001', sent_at = now()
      where tenant_id = ${one.tenantId} and batch_id = ${commandId}`;

    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: "5491155550002",
                    id: "wamid.ITIN1",
                    text: { body: "BAJA" },
                    type: "text"
                  }
                ],
                metadata: { phone_number_id: "50000000001" },
                statuses: [{ id: "wamid.IT0001", status: "delivered" }]
              }
            }
          ]
        }
      ],
      object: "whatsapp_business_account"
    };
    expect((await webhook(payload, "sha256=" + "0".repeat(64))).status).toBe(
      401
    );
    const raw = JSON.stringify(payload);
    const tampered = await app!
      .getHttpAdapter()
      .getInstance()
      .inject({
        headers: {
          "content-type": "application/json",
          "x-hub-signature-256": signWebhookBody(appSecret, raw)
        },
        method: "POST",
        payload: raw.replace("BAJA", "HOLA"),
        url: "/v1/webhooks/whatsapp"
      });
    expect(tampered.statusCode).toBe(401);

    const applied = await webhook(payload);
    expect(applied.status).toBe(200);
    expect(applied.body.data.received).toBe(2);
    const [message] = await admin<{ status: string }[]>`
      select status from private.messaging_outbox
      where tenant_id = ${one.tenantId} and batch_id = ${commandId}`;
    expect(message!.status).toBe("delivered");
    const [consent] = await admin<{ action: string; source: string }[]>`
      select action, source from private.diner_consent_events
      where tenant_id = ${one.tenantId} and profile_id = ${profile} and kind = 'marketing'
      order by id desc limit 1`;
    expect(consent).toEqual({ action: "revoked", source: "whatsapp_optout" });

    // The same notification again changes nothing.
    const eventsBefore = await admin<{ total: number }[]>`
      select count(*)::int as total from private.diner_consent_events where tenant_id = ${one.tenantId}`;
    expect((await webhook(payload)).status).toBe(200);
    const eventsAfter = await admin<{ total: number }[]>`
      select count(*)::int as total from private.diner_consent_events where tenant_id = ${one.tenantId}`;
    expect(eventsAfter[0]!.total).toBe(eventsBefore[0]!.total);
    const [seen] = await admin<{ total: number }[]>`
      select count(*)::int as total from private.messaging_webhook_events
      where event_key in ('status:wamid.IT0001:delivered', 'message:wamid.ITIN1')`;
    expect(seen!.total).toBe(2);
  });

  it("offers the PWA notifications: the diner subscribes, the Encargado writes and turns them on", async () => {
    const config = await dinerCall(
      one,
      "GET",
      "/v1/public/diner/push/config",
      null
    );
    expect(config.body.data).toEqual({
      available: true,
      publicKey: vapidPublicKey
    });

    await newDiner(one.tenantId, "Camila", "+5491155550201");
    const token = await dinerToken(one.tenantId);
    const keys = browserKeys(1);
    expect(
      (
        await dinerCall(
          one,
          "POST",
          "/v1/public/diner/push/subscriptions",
          null,
          keys
        )
      ).status
    ).toBe(401);
    expect(
      (
        await dinerCall(
          one,
          "POST",
          "/v1/public/diner/push/subscriptions",
          token,
          { ...keys, endpoint: "http://insecure.example/x" }
        )
      ).status
    ).toBe(400);
    expect(
      (
        await dinerCall(
          one,
          "POST",
          "/v1/public/diner/push/subscriptions",
          token,
          { ...keys, tenantId: one.tenantId }
        )
      ).status
    ).toBe(400);
    const subscribed = await dinerCall(
      one,
      "POST",
      "/v1/public/diner/push/subscriptions",
      token,
      keys
    );
    expect(subscribed.body.data).toEqual({ subscribed: true });
    const state = (endpoint: string) =>
      dinerCall(
        one,
        "POST",
        "/v1/public/diner/push/subscriptions/state",
        token,
        { endpoint }
      );
    expect((await state(keys.endpoint)).body.data).toEqual({
      subscribed: true
    });
    expect((await state(browserKeys(2).endpoint)).body.data).toEqual({
      subscribed: false
    });

    // The same session is worthless at the other restaurant.
    expect(
      (
        await dinerCall(
          two,
          "POST",
          "/v1/public/diner/push/subscriptions",
          token,
          browserKeys(3)
        )
      ).status
    ).toBe(401);

    // The Encargado sees how many people can be reached, never who or where.
    const overview = await staff("marta", "GET", "/v1/staff/messaging");
    expect(overview.body.data.push).toEqual({
      sendingEnabled: false,
      subscribers: 1
    });
    expect(overview.text).not.toContain(keys.endpoint);
    expect(
      (
        await staff("ana", "PUT", "/v1/staff/messaging/push/sending", {
          enabled: true
        })
      ).status
    ).toBe(403);
    const written = await staff(
      "marta",
      "PUT",
      "/v1/staff/messaging/push/templates",
      {
        body: "Hola {{1}}, ya tenés un premio.",
        category: "operational",
        name: "aviso_premio"
      }
    );
    const template = written.body.data.templates.find(
      (t: { name: string }) => t.name === "aviso_premio"
    );
    expect(template).toMatchObject({
      approvalStatus: "approved",
      channel: "web_push"
    });
    expect(
      (
        await staff("marta", "PUT", "/v1/staff/messaging/push/templates", {
          body: "x".repeat(241),
          category: "operational",
          name: "larga"
        })
      ).status
    ).toBe(400);
    const on = await staff("marta", "PUT", "/v1/staff/messaging/push/sending", {
      enabled: true
    });
    expect(on.body.data.push.sendingEnabled).toBe(true);

    // The people to choose from say who can be reached by push, without the browser.
    const audience = await staff(
      "marta",
      "GET",
      "/v1/staff/messaging/audience"
    );
    expect(
      audience.body.data.find(
        (p: { displayName: string }) => p.displayName === "Camila"
      )
    ).toMatchObject({ pushConsent: true });
    expect(audience.text).not.toMatch(/endpoint|p256dh|push\.example/u);

    const revoked = await dinerCall(
      one,
      "POST",
      "/v1/public/diner/push/subscriptions/revoke",
      token,
      { endpoint: keys.endpoint }
    );
    expect(revoked.body.data).toEqual({ subscribed: false });
    expect(
      (await staff("marta", "GET", "/v1/staff/messaging")).body.data.push
        .subscribers
    ).toBe(0);
  });

  it("disconnects and removes the credential and the templates", async () => {
    const response = await staff(
      "marta",
      "DELETE",
      "/v1/staff/messaging/connection"
    );
    expect(response.status).toBe(200);
    expect(response.body.data.connection).toBeNull();
    expect(
      response.body.data.templates.map((t: { channel: string }) => t.channel)
    ).toEqual(["web_push"]);
    const [row] = await admin<{ total: number }[]>`
      select count(*)::int as total from private.whatsapp_connections where tenant_id = ${one.tenantId}`;
    expect(row!.total).toBe(0);
  });
});
