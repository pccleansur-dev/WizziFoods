import { createHash, randomBytes } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTenantDatabase, type TenantDatabase } from "./index.js";

const databaseUrl = process.env.DATABASE_URL;
const databaseAdminUrl = process.env.DATABASE_ADMIN_URL ?? databaseUrl;
const describeWithLocalStack =
  databaseUrl && databaseAdminUrl ? describe : describe.skip;

const hex = (value: string) => createHash("sha256").update(value).digest("hex");

describeWithLocalStack("messaging races against local Supabase", () => {
  const tenantId = "3f200000-0000-4000-8000-000000000001";
  const userId = "3f100000-0000-4000-8000-000000000001";
  const admin = postgres(databaseAdminUrl ?? "", { prepare: false });
  let database: TenantDatabase;
  let locationId = "";
  let staffId = "";
  let promoTemplate = "";
  let operationalTemplate = "";
  const accounts: string[] = [];
  let counter = 0;
  const uuidOf = () =>
    `3f700000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
  const scope = () => ({ locationId, tenantId });
  const repository = () => database.messagingRepository;

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
    const kinds = marketing
      ? ["whatsapp_verified", "marketing"]
      : ["whatsapp_verified"];
    for (const kind of kinds) {
      await admin`
        select private.record_diner_consent(
          ${tenantId}::uuid, ${accountId}::uuid, ${uuidOf()}::uuid,
          ${kind}::text, 'granted', 1, 'profile')`;
    }
    const [row] = await admin<{ id: string }[]>`
      select private.diner_profile_id_of(${tenantId}::uuid, ${accountId}::uuid) as id`;
    return row!.id;
  }

  /** Confirmed one-off messages, one per event key, for one person. */
  async function queueFor(profileId: string, template: string, count: number) {
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

  async function cleanup() {
    await admin.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`delete from private.messaging_events where tenant_id = ${tenantId}`;
      await tx`delete from private.messaging_outbox where tenant_id = ${tenantId}`;
      await tx`delete from private.messaging_automations where tenant_id = ${tenantId}`;
      await tx`delete from private.whatsapp_templates where tenant_id = ${tenantId}`;
      await tx`delete from private.whatsapp_connections where tenant_id = ${tenantId}`;
      await tx`delete from private.messaging_webhook_events where event_key like 'it-%'`;
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

  /** Moves the location's clock so that "now" is 15:00 there (inside the hours). */
  async function setLocalHour(hour: number) {
    let shift = hour - new Date().getUTCHours();
    if (shift > 14) shift -= 24;
    if (shift < -12) shift += 24;
    const zone = `Etc/GMT${shift > 0 ? `-${shift}` : shift < 0 ? `+${-shift}` : ""}`;
    await admin`update public.locations set timezone = ${zone} where id = ${locationId}`;
  }

  beforeAll(async () => {
    database = createTenantDatabase(databaseUrl ?? "");
    await cleanup();
    await admin`insert into auth.users (id) values (${userId})`;
    await admin`
      insert into public.tenants (id, slug, name, status)
      values (${tenantId}, 'messaging-race', 'Messaging Race', 'active')`;
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
    await setLocalHour(15);
    await repository().connect({
      credential: { ciphertext: randomBytes(48), keyVersion: 1 },
      displayPhone: null,
      phoneNumberId: "30000000001",
      scope: scope(),
      staffId,
      wabaId: "40000000001"
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
          body: "Hola {{1}}, ganaste un premio",
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
  });

  afterAll(async () => {
    await cleanup();
    await admin.end();
    await database.close();
  });

  it("confirms an event once even when it is confirmed many times at once", async () => {
    const people = await Promise.all(
      [1, 2, 3].map((n) => newDiner(`confirma${n}`, `+549113333000${n}`))
    );
    const commandId = uuidOf();
    await Promise.all(
      Array.from({ length: 4 }, () =>
        repository().proposeOneOff({
          commandId,
          profileIds: people,
          scope: scope(),
          staffId,
          templateId: promoTemplate,
          variables: ["Hola"]
        })
      )
    );
    const [counted] = await admin<{ total: number }[]>`
      select count(*)::int as total from private.messaging_outbox
      where tenant_id = ${tenantId} and batch_id = ${commandId}`;
    expect(counted!.total).toBe(3);

    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        repository().decideOneOff({
          batchId: commandId,
          decision: "confirm",
          scope: scope(),
          staffId
        })
      )
    );
    expect(results.reduce((sum, result) => sum + result.changed, 0)).toBe(3);
    const [queuedRow] = await admin<{ queued: number }[]>`
      select count(*)::int as queued from private.messaging_events
      where tenant_id = ${tenantId} and kind = 'queued'
        and outbox_id in (select id from private.messaging_outbox where batch_id = ${commandId})`;
    expect(queuedRow!.queued).toBe(3);
  });

  it("queues the same automatic event for the same person only once", async () => {
    const profile = await newDiner("evento", "+5491133330010");
    const [automation] = await admin<{ id: string }[]>`
      select (item ->> 'id')::uuid as id
      from jsonb_array_elements(private.save_messaging_automation(
        ${tenantId}::uuid, ${locationId}::uuid, ${staffId}::uuid,
        'reward_earned', ${operationalTemplate}::uuid) -> 'automations') item
      where item ->> 'kind' = 'reward_earned'`;
    await repository().decideAutomation({
      automationId: automation!.id,
      decision: "approve",
      scope: scope(),
      staffId
    });
    const attempts = await Promise.all(
      Array.from(
        { length: 8 },
        () =>
          admin<{ queued: boolean }[]>`
          select private.enqueue_messaging_event(
            ${tenantId}::uuid, ${locationId}::uuid, ${profile}::uuid,
            'reward_earned', 'reward_earned:same-reward', '["Evento","10%"]'::jsonb
          ) as queued`
      )
    );
    expect(attempts.filter(([row]) => row?.queued).length).toBe(1);
    const [onlyOne] = await admin<{ total: number }[]>`
      select count(*)::int as total from private.messaging_outbox
      where tenant_id = ${tenantId} and profile_id = ${profile}
        and event_key = 'reward_earned:same-reward'`;
    expect(onlyOne!.total).toBe(1);
  });

  it("lets only one of two workers send the same message", async () => {
    const profile = await newDiner("carrera", "+5491133330020");
    const [outboxId] = await queueFor(profile, operationalTemplate, 1);
    const claims = await Promise.all([
      repository().claimOutbox({ leaseSeconds: 60, limit: 100 }),
      repository().claimOutbox({ leaseSeconds: 60, limit: 100 })
    ]);
    const claimed = claims.flat().filter((claim) => claim.id === outboxId);
    expect(claimed).toHaveLength(1);

    const begins = await Promise.all(
      Array.from({ length: 6 }, () =>
        repository().beginSend({ outboxId: outboxId!, scope: scope() })
      )
    );
    expect(begins.filter((result) => result.action === "send")).toHaveLength(1);
    expect(begins.filter((result) => result.action === "skip")).toHaveLength(5);
    const [row] = await admin<{ attempts: number; status: string }[]>`
      select attempts, status from private.messaging_outbox where id = ${outboxId!}`;
    expect(row).toEqual({ attempts: 1, status: "sending" });
  });

  it("never exceeds two promotional messages a week, even if sent at once", async () => {
    const profile = await newDiner("tope", "+5491133330030");
    const ids = await queueFor(profile, promoTemplate, 6);
    const begins = await Promise.all(
      ids.map((outboxId) =>
        repository().beginSend({ outboxId, scope: scope() })
      )
    );
    expect(begins.filter((result) => result.action === "send")).toHaveLength(2);
    const blocked = begins.filter((result) => result.action === "blocked");
    expect(blocked).toHaveLength(4);
    expect(
      blocked.every((r) => r.action === "blocked" && r.reason === "weekly_cap")
    ).toBe(true);
  });

  it("blocks at once what is waiting when the person writes BAJA", async () => {
    const profile = await newDiner("baja", "+5491133330040");
    const ids = await queueFor(profile, promoTemplate, 2);
    const [operational] = await queueFor(profile, operationalTemplate, 1);
    await expect(
      repository().recordOptOut({
        phone: "+5491133330040",
        phoneNumberId: "30000000001"
      })
    ).resolves.toBe("applied");
    const rows = await admin<{ status: string }[]>`
      select status from private.messaging_outbox where id = any(${ids}::uuid[])`;
    expect(rows.map((row) => row.status)).toEqual(["blocked", "blocked"]);
    const result = await repository().beginSend({
      outboxId: operational!,
      scope: scope()
    });
    expect(result.action).toBe("send");
    const [event] = await admin<{ source: string }[]>`
      select source from private.diner_consent_events
      where tenant_id = ${tenantId} and profile_id = ${profile} and kind = 'marketing'
      order by id desc limit 1`;
    expect(event?.source).toBe("whatsapp_optout");
  });

  it("applies each webhook event once", async () => {
    const claims = await Promise.all(
      Array.from({ length: 6 }, () =>
        repository().claimWebhookEvent({
          eventKey: "it-evt-1",
          topic: "status"
        })
      )
    );
    expect(claims.filter((claim) => claim === "new")).toHaveLength(1);
    await repository().finishWebhookEvent({
      eventKey: "it-evt-1",
      outcome: "applied"
    });
    await expect(
      repository().claimWebhookEvent({ eventKey: "it-evt-1", topic: "status" })
    ).resolves.toBe("duplicate");
  });
});
