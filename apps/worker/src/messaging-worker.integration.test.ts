import { createHash } from "node:crypto";

import { createTenantDatabase, type TenantDatabase } from "@platform/database";
import {
  PaymentSecretSealer,
  SimulatedWebPushProvider,
  SimulatedWhatsappProvider,
  WHATSAPP_SECRET_METHOD
} from "@platform/integrations";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { runMessagingIteration } from "./messaging-worker.js";

const databaseUrl = process.env.DATABASE_URL;
const databaseAdminUrl = process.env.DATABASE_ADMIN_URL ?? databaseUrl;
const describeWithLocalStack =
  databaseUrl && databaseAdminUrl ? describe : describe.skip;

const hex = (value: string) => createHash("sha256").update(value).digest("hex");
const token = "EAAG-worker-test-token-0123456789";

describeWithLocalStack("messaging worker against local Supabase", () => {
  const tenantId = "3a200000-0000-4000-8000-000000000001";
  const userId = "3a100000-0000-4000-8000-000000000001";
  const admin = postgres(databaseAdminUrl ?? "", { prepare: false });
  const sealer = new PaymentSecretSealer(Buffer.alloc(32, 5));
  let database: TenantDatabase;
  let provider: SimulatedWhatsappProvider;
  let push: SimulatedWebPushProvider;
  let pushTemplate = "";
  let pushPromoTemplate = "";
  let locationId = "";
  let staffId = "";
  let promoTemplate = "";
  let operationalTemplate = "";
  const accounts: string[] = [];
  let counter = 0;
  const uuidOf = () =>
    `3a700000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
  const scope = () => ({ locationId, tenantId });
  const repository = () => database.messagingRepository;
  const run = (only: "all" | "push" | "whatsapp" = "all") =>
    runMessagingIteration({
      leaseSeconds: 60,
      limit: 100,
      repository: repository(),
      webPush: only === "whatsapp" ? null : push,
      whatsapp: only === "push" ? null : { provider, sealer }
    });

  async function newDiner(name: string, phone: string, marketing = true) {
    const accountId = await database.dinerIdentityRepository.upsertAccount({
      email: `${name}@example.com`,
      subHash: hex(`${name}-${Date.now()}-${Math.random()}`)
    });
    accounts.push(accountId);
    await database.dinerIdentityRepository.saveProfile({
      accountId,
      request: { displayName: name, whatsappPhone: phone },
      tenantId
    });
    for (const kind of marketing
      ? ["whatsapp_verified", "marketing"]
      : ["whatsapp_verified"]) {
      await admin`
        select private.record_diner_consent(
          ${tenantId}::uuid, ${accountId}::uuid, ${uuidOf()}::uuid,
          ${kind}::text, 'granted', 1, 'profile')`;
    }
    const [row] = await admin<{ id: string }[]>`
      select private.diner_profile_id_of(${tenantId}::uuid, ${accountId}::uuid) as id`;
    return row!.id;
  }

  const keys = (n: number) => ({
    auth: "B".repeat(22),
    endpoint: `https://push.example.com/send/worker-${n}`,
    p256dh: "A".repeat(87)
  });
  let browsers = 0;

  /** A diner with a profile and no phone, reachable only through its browsers. */
  async function pushDiner(name: string, count: number, marketing = true) {
    const profile = await newDiner(name, "+5491144449999", marketing);
    const accountId = accounts[accounts.length - 1]!;
    const endpoints: string[] = [];
    for (let n = 0; n < count; n += 1) {
      browsers += 1;
      const request = keys(browsers);
      endpoints.push(request.endpoint);
      await repository().registerPush({ accountId, request, scope: scope() });
    }
    return { endpoints, profile };
  }

  async function queue(profileId: string, template: string, count: number) {
    const ids: string[] = [];
    for (let n = 0; n < count; n += 1) {
      const commandId = uuidOf();
      await repository().proposeOneOff({
        commandId,
        profileIds: [profileId],
        scope: scope(),
        staffId,
        templateId: template,
        variables: ["Hola"]
      });
      await repository().decideOneOff({
        batchId: commandId,
        decision: "confirm",
        scope: scope(),
        staffId
      });
      const [row] = await admin<{ id: string }[]>`
        select id from private.messaging_outbox
        where tenant_id = ${tenantId} and batch_id = ${commandId}`;
      ids.push(row!.id);
    }
    return ids;
  }

  const rowOf = async (id: string) => {
    const [row] = await admin<
      { attempts: number; last_error: string | null; status: string }[]
    >`select attempts, last_error, status from private.messaging_outbox where id = ${id}`;
    return row!;
  };
  const dueNow = (id: string) =>
    admin`update private.messaging_outbox set next_attempt_at = now() where id = ${id}`;

  async function setLocalHour(hour: number) {
    let shift = hour - new Date().getUTCHours();
    if (shift > 14) shift -= 24;
    if (shift < -12) shift += 24;
    const zone = `Etc/GMT${shift > 0 ? `-${shift}` : shift < 0 ? `+${-shift}` : ""}`;
    await admin`update public.locations set timezone = ${zone} where id = ${locationId}`;
  }

  async function cleanup() {
    await admin.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`delete from private.messaging_events where tenant_id = ${tenantId}`;
      await tx`delete from private.push_subscriptions where tenant_id = ${tenantId}`;
      await tx`delete from private.push_settings where tenant_id = ${tenantId}`;
      await tx`delete from private.messaging_outbox where tenant_id = ${tenantId}`;
      await tx`delete from private.messaging_automations where tenant_id = ${tenantId}`;
      await tx`delete from private.whatsapp_templates where tenant_id = ${tenantId}`;
      await tx`delete from private.whatsapp_connections where tenant_id = ${tenantId}`;
      await tx`delete from private.loyalty_visits where tenant_id = ${tenantId}`;
      await tx`delete from private.loyalty_rewards where tenant_id = ${tenantId}`;
      await tx`delete from private.diner_birthdays where tenant_id = ${tenantId}`;
      await tx`delete from private.loyalty_settings where tenant_id = ${tenantId}`;
      await tx`delete from private.diner_session_links where tenant_id = ${tenantId}`;
      await tx`delete from private.diner_consent_events where tenant_id = ${tenantId}`;
      await tx`delete from private.diner_profile_links where tenant_id = ${tenantId}`;
      await tx`delete from private.diner_profiles where tenant_id = ${tenantId}`;
      await tx`delete from private.diner_sessions where tenant_id = ${tenantId}`;
      await tx`delete from private.diner_login_exchanges where tenant_id = ${tenantId}`;
      await tx`delete from private.diner_accounts where email like '%@example.com' and id = any(${accounts}::uuid[])`;
      await tx`delete from private.cashier_requests where tenant_id = ${tenantId}`;
      await tx`delete from private.account_receipts where tenant_id = ${tenantId}`;
      await tx`delete from private.receipt_counters where tenant_id = ${tenantId}`;
      await tx`delete from private.table_group_events where tenant_id = ${tenantId}`;
      await tx`delete from private.table_sessions where tenant_id = ${tenantId}`;
    });
    await admin`delete from private.waiter_commands where tenant_id = ${tenantId}`;
    await admin`delete from private.audit_events where tenant_id = ${tenantId}`;
    await admin`delete from public.tenants where id = ${tenantId}`;
    await admin`delete from auth.users where id = ${userId}`;
  }

  beforeAll(async () => {
    database = createTenantDatabase(databaseUrl ?? "");
    await cleanup();
    await admin`insert into auth.users (id) values (${userId})`;
    await admin`
      insert into public.tenants (id, slug, name, status)
      values (${tenantId}, 'messaging-worker', 'Messaging Worker', 'active')`;
    await admin`insert into public.tenant_memberships (tenant_id, user_id, role) values (${tenantId}, ${userId}, 'admin')`;
    const [location] = await admin<{ id: string }[]>`
      select id from public.locations where tenant_id = ${tenantId}`;
    locationId = location!.id;
    const [staff] = await admin<{ id: string }[]>`
      select (private.create_staff_member(
        ${tenantId}::uuid, ${locationId}::uuid, ${userId}::uuid,
        'marta', 'Marta', 'manager', 'scrypt-v1$c2FsdA$aGFzaA', '{}'::uuid[]
      ) ->> 'id')::uuid as id`;
    staffId = staff!.id;
    await repository().connect({
      credential: sealer.seal(token, scope(), WHATSAPP_SECRET_METHOD),
      displayPhone: null,
      phoneNumberId: "30000000002",
      scope: scope(),
      staffId,
      wabaId: "40000000002"
    });
    const overview = await repository().upsertTemplates({
      scope: scope(),
      staffId,
      templates: [
        {
          body: "Hola {{1}}",
          category: "promotional",
          language: "es_AR",
          name: "promo",
          status: "approved"
        },
        {
          body: "Hola {{1}}, premio",
          category: "operational",
          language: "es_AR",
          name: "premio",
          status: "approved"
        }
      ]
    });
    promoTemplate = overview.templates.find((t) => t.name === "promo")!.id;
    operationalTemplate = overview.templates.find(
      (t) => t.name === "premio"
    )!.id;
    await repository().setSending({ enabled: true, scope: scope(), staffId });
    await repository().setPushSending({
      enabled: true,
      scope: scope(),
      staffId
    });
    await repository().savePushTemplate({
      request: {
        body: "Hola {{1}}, ya tenés un premio.",
        category: "operational",
        name: "aviso"
      },
      scope: scope(),
      staffId
    });
    const withPush = await repository().savePushTemplate({
      request: {
        body: "Hola {{1}}, novedades.",
        category: "promotional",
        name: "novedad"
      },
      scope: scope(),
      staffId
    });
    pushTemplate = withPush.templates.find((t) => t.name === "aviso")!.id;
    pushPromoTemplate = withPush.templates.find(
      (t) => t.name === "novedad"
    )!.id;
  });

  beforeEach(async () => {
    // The queue is shared by the whole local database: whatever another suite left due
    // is put behind a lease for a few minutes so this one only sees its own messages.
    await admin`
      update private.messaging_outbox
      set locked_until = now() + interval '10 minutes'
      where tenant_id <> ${tenantId} and status = 'queued'
        and next_attempt_at <= now()
        and (locked_until is null or locked_until < now())`;
    provider = new SimulatedWhatsappProvider();
    push = new SimulatedWebPushProvider();
    await setLocalHour(15);
  });

  afterAll(async () => {
    await cleanup();
    await admin.end();
    await database.close();
  });

  it("sends the template with the opened token to the profile's own phone", async () => {
    const profile = await newDiner("envio", "+5491144440001");
    const [id] = await queue(profile, operationalTemplate, 1);
    const summary = await run();
    expect(summary.sent).toBe(1);
    expect(provider.sent).toEqual([
      {
        accessToken: token,
        language: "es_AR",
        phoneNumberId: "30000000002",
        templateName: "premio",
        to: "+5491144440001",
        variables: ["Hola"]
      }
    ]);
    expect((await rowOf(id!)).status).toBe("sent");
  });

  it("sends at most two promotional messages a week and blocks the rest", async () => {
    const profile = await newDiner("limite", "+5491144440002");
    const ids = await queue(profile, promoTemplate, 4);
    const summary = await run();
    expect(summary).toMatchObject({ blocked: 2, sent: 2 });
    expect(provider.sent).toHaveLength(2);
    const reasons = await Promise.all(ids.map(rowOf));
    expect(reasons.filter((row) => row.status === "blocked")).toHaveLength(2);
    expect(reasons.find((row) => row.status === "blocked")?.last_error).toBe(
      "weekly_cap"
    );
    // Operational notices still go out to the same person.
    const [notice] = await queue(profile, operationalTemplate, 1);
    await run();
    expect((await rowOf(notice!)).status).toBe("sent");
  });

  it("retries with a growing wait and gives up after the attempt limit", async () => {
    const profile = await newDiner("reintento", "+5491144440003");
    const [id] = await queue(profile, operationalTemplate, 1);
    provider.failNext("transient_failure", 2);

    expect(await run()).toMatchObject({ retried: 1, sent: 0 });
    const [first] = await admin<{ wait: number }[]>`
      select extract(epoch from next_attempt_at - now())::int as wait
      from private.messaging_outbox where id = ${id!}`;
    expect(first!.wait).toBeGreaterThan(20);
    expect(await run()).toMatchObject({ retried: 0, sent: 0 });

    await dueNow(id!);
    expect(await run()).toMatchObject({ retried: 1 });
    const [second] = await admin<{ wait: number }[]>`
      select extract(epoch from next_attempt_at - now())::int as wait
      from private.messaging_outbox where id = ${id!}`;
    expect(second!.wait).toBeGreaterThan(first!.wait);

    await dueNow(id!);
    expect(await run()).toMatchObject({ sent: 1 });
    expect(await rowOf(id!)).toMatchObject({ attempts: 3, status: "sent" });

    const [gone] = await queue(profile, operationalTemplate, 1);
    provider.failNext("transient_failure", 10);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await dueNow(gone!);
      await run();
    }
    const exhausted = await rowOf(gone!);
    expect(exhausted.status).toBe("failed");
    expect(exhausted.attempts).toBe(5);
    expect(exhausted.last_error).toMatch(/^retries_exhausted/u);
  });

  it("does not retry a permanent failure", async () => {
    const profile = await newDiner("permanente", "+5491144440004");
    const [id] = await queue(profile, operationalTemplate, 1);
    provider.failNext("permanent_failure");
    expect(await run()).toMatchObject({ failed: 1, retried: 0 });
    expect(await rowOf(id!)).toMatchObject({ attempts: 1, status: "failed" });
    expect(provider.sent).toHaveLength(0);
  });

  it("stops promotions the moment the person writes BAJA, not operational notices", async () => {
    const profile = await newDiner("bajista", "+5491144440005");
    const promos = await queue(profile, promoTemplate, 2);
    const [notice] = await queue(profile, operationalTemplate, 1);
    await expect(
      repository().recordOptOut({
        phone: "+5491144440005",
        phoneNumberId: "30000000002"
      })
    ).resolves.toBe("applied");
    const summary = await run();
    expect(summary.sent).toBe(1);
    expect(provider.sent.map((entry) => entry.templateName)).toEqual([
      "premio"
    ]);
    expect(
      (await Promise.all(promos.map(rowOf))).map((row) => row.last_error)
    ).toEqual(["opt_out", "opt_out"]);
    expect((await rowOf(notice!)).status).toBe("sent");
  });

  it("waits for the hours window without spending an attempt", async () => {
    const profile = await newDiner("noche", "+5491144440006");
    const [id] = await queue(profile, promoTemplate, 1);
    await setLocalHour(23);
    expect(await run()).toMatchObject({ deferred: 1, sent: 0 });
    expect(provider.sent).toHaveLength(0);
    const [row] = await admin<
      { attempts: number; hours: number; status: string }[]
    >`
      select attempts, status,
        extract(hour from next_attempt_at at time zone (select timezone from public.locations where id = ${locationId}))::int as hours
      from private.messaging_outbox where id = ${id!}`;
    expect(row).toEqual({ attempts: 0, hours: 10, status: "queued" });
  });

  it("never sends a message twice when two workers run at once", async () => {
    const people = await Promise.all(
      [1, 2, 3].map((n) => newDiner(`doble${n}`, `+549114444010${n}`))
    );
    const ids: string[] = [];
    for (const person of people)
      ids.push(...(await queue(person, operationalTemplate, 4)));
    const results = await Promise.all([run(), run(), run()]);
    expect(results.reduce((sum, result) => sum + result.sent, 0)).toBe(12);
    expect(provider.sent).toHaveLength(12);
    const statuses = await Promise.all(ids.map(rowOf));
    expect(
      statuses.every((row) => row.status === "sent" && row.attempts === 1)
    ).toBe(true);
  });

  it("delivers a push to every browser of the person, with the text filled in", async () => {
    const { endpoints, profile } = await pushDiner("navegantes", 2);
    const [id] = await queue(profile, pushTemplate, 1);
    expect(await run()).toMatchObject({ sent: 1 });
    expect(push.sent.map((entry) => entry.subscription.endpoint)).toEqual(
      endpoints
    );
    const payload = JSON.parse(push.sent[0]!.payload);
    expect(payload).toMatchObject({
      body: "Hola Hola, ya tenés un premio.",
      url: "/cuenta"
    });
    expect(push.sent[0]!.urgency).toBe("high");
    expect(await rowOf(id!)).toMatchObject({ attempts: 1, status: "sent" });
  });

  it("drops a browser the push service no longer knows and stops when none is left", async () => {
    const { endpoints, profile } = await pushDiner("fantasmas", 2);
    push.goneEndpoints.add(endpoints[0]!);
    const [first] = await queue(profile, pushTemplate, 1);
    expect(await run()).toMatchObject({ sent: 1 });
    expect(push.sent).toHaveLength(1);
    expect((await rowOf(first!)).status).toBe("sent");
    const [revoked] = await admin<{ revoked_reason: string | null }[]>`
      select revoked_reason from private.push_subscriptions where endpoint = ${endpoints[0]!}`;
    expect(revoked?.revoked_reason).toBe("gone");

    push.goneEndpoints.add(endpoints[1]!);
    const [second] = await queue(profile, pushTemplate, 1);
    expect(await run()).toMatchObject({ failed: 1 });
    expect((await rowOf(second!)).status).toBe("failed");
    // The next message finds no browser left and is blocked, never sent.
    const [third] = await queue(profile, pushTemplate, 1);
    expect(await run()).toMatchObject({ blocked: 1 });
    expect((await rowOf(third!)).last_error).toBe("no_subscription");
  });

  it("retries a push that could not be delivered", async () => {
    const { profile } = await pushDiner("reintentos", 1);
    const [id] = await queue(profile, pushTemplate, 1);
    push.failNext("transient_failure");
    expect(await run()).toMatchObject({ retried: 1, sent: 0 });
    await dueNow(id!);
    expect(await run()).toMatchObject({ sent: 1 });
    expect(await rowOf(id!)).toMatchObject({ attempts: 2, status: "sent" });
  });

  it("leaves the messages of a channel it does not deliver for another worker", async () => {
    const { profile } = await pushDiner("canal", 1);
    const [id] = await queue(profile, pushTemplate, 1);
    expect(await run("whatsapp")).toMatchObject({ sent: 0 });
    expect(await rowOf(id!)).toMatchObject({ attempts: 0, status: "queued" });
    expect(await run("push")).toMatchObject({ sent: 1 });
    expect((await rowOf(id!)).status).toBe("sent");
  });

  it("keeps one promotional allowance for both channels", async () => {
    const profile = await newDiner("ambos", "+5491144440077");
    const accountId = accounts[accounts.length - 1]!;
    browsers += 1;
    await repository().registerPush({
      accountId,
      request: keys(browsers),
      scope: scope()
    });
    const wa = await queue(profile, promoTemplate, 2);
    const viaPush = await queue(profile, pushPromoTemplate, 2);
    const summary = await run();
    expect(summary).toMatchObject({ blocked: 2, sent: 2 });
    expect(provider.sent.length + push.sent.length).toBe(2);
    const states = await Promise.all([...wa, ...viaPush].map(rowOf));
    expect(
      states.filter((row) => row.last_error === "weekly_cap")
    ).toHaveLength(2);
  });

  it("does not deliver a promotion by push without the marketing consent", async () => {
    const { profile } = await pushDiner("sinpromo", 1, false);
    const [id] = await queue(profile, pushPromoTemplate, 1);
    expect(await run()).toMatchObject({ blocked: 1 });
    expect((await rowOf(id!)).last_error).toBe("marketing_consent_missing");
    expect(push.sent).toHaveLength(0);
  });
});
