import { createHash } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTenantDatabase, type TenantDatabase } from "./index.js";

const databaseUrl = process.env.DATABASE_URL;
const databaseAdminUrl = process.env.DATABASE_ADMIN_URL ?? databaseUrl;
const describeWithLocalStack =
  databaseUrl && databaseAdminUrl ? describe : describe.skip;

const sha = (value: string) => createHash("sha256").update(value).digest();
const hex = (value: string) => createHash("sha256").update(value).digest("hex");

describeWithLocalStack("diner identity races against local Supabase", () => {
  const tenantId = "3f200000-0000-4000-8000-000000000001";
  const userId = "3f100000-0000-4000-8000-000000000001";
  const tableId = "3f600000-0000-4000-8000-000000000001";
  const admin = postgres(databaseAdminUrl ?? "", { prepare: false });
  let database: TenantDatabase;
  let locationId = "";
  let token = "";
  let sessionId = "";
  const accounts: string[] = [];
  let counter = 0;
  const command = () =>
    `3f700000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;

  async function newAccount(name: string) {
    const id = await database.dinerIdentityRepository.upsertAccount({
      email: `${name}@example.com`,
      subHash: hex(`${name}-${Date.now()}-${Math.random()}`)
    });
    accounts.push(id);
    await database.dinerIdentityRepository.saveProfile({
      accountId: id,
      request: { displayName: name, whatsappPhone: "+5491112345678" },
      tenantId
    });
    return id;
  }

  async function cleanup() {
    await admin.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
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
      values (${tenantId}, 'diner-race', 'Diner Race', 'active')`;
    await admin`insert into public.tenant_memberships (tenant_id, user_id, role) values (${tenantId}, ${userId}, 'admin')`;
    const [location] = await admin<{ id: string }[]>`
      select id from public.locations where tenant_id = ${tenantId}`;
    locationId = location!.id;
    const plan = {
      floors: [
        {
          id: "3f400000-0000-4000-8000-000000000001",
          name: "Planta baja",
          position: 0,
          shortName: null
        }
      ],
      groups: [],
      sectors: [
        {
          id: "3f500000-0000-4000-8000-000000000001",
          name: "Salón",
          position: 0
        }
      ],
      tables: [
        {
          floorId: "3f400000-0000-4000-8000-000000000001",
          height: 100,
          id: tableId,
          label: "1",
          rotation: 0,
          sectorId: "3f500000-0000-4000-8000-000000000001",
          seatCount: 4,
          seatLayout: "perimeter",
          shape: "square",
          width: 100,
          x: 40,
          y: 40
        }
      ]
    };
    await admin`select private.save_floor_plan(
      ${tenantId}::uuid, ${locationId}::uuid, ${userId}::uuid,
      '3f300000-0000-4000-8000-000000000001'::uuid, 0, ${JSON.stringify(plan)}::text::jsonb)`;
    const [staff] = await admin<{ result: { id: string } }[]>`
      select private.create_staff_member(
        ${tenantId}::uuid, ${locationId}::uuid, ${userId}::uuid,
        'marta', 'Marta', 'manager', 'scrypt-v1$c2FsdA$aGFzaA', '{}'::uuid[]) as result`;
    const [session] = await admin<{ id: string }[]>`
      select private.ensure_table_session(
        ${tenantId}::uuid, ${locationId}::uuid, ${tableId}::uuid,
        ${staff!.result.id}::uuid) as id`;
    sessionId = session!.id;
    const [qr] = await admin<{ token: string }[]>`
      select token from private.floor_table_qr_codes
      where table_id = ${tableId} and status = 'active'`;
    token = qr!.token;
  });

  afterAll(async () => {
    await cleanup();
    await admin.end();
    await database.close();
  });

  it("links the same account to the session many times at once, once", async () => {
    const accountId = await newAccount("ana");
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        database.dinerIdentityRepository.linkToSession({
          accountId,
          scope: { locationId, tenantId },
          token
        })
      )
    );
    expect(results.every((result) => result.linked)).toBe(true);
    const links = await admin`
      select count(*)::int as count from private.diner_session_links
      where tenant_id = ${tenantId} and session_id = ${sessionId}`;
    expect(links[0]?.count).toBe(1);
  });

  it("serializes a revocation racing an acceptance into a coherent history", async () => {
    const accountId = await newAccount("beto");
    const repository = database.dinerIdentityRepository;
    const request = (action: "granted" | "revoked") => ({
      action,
      commandId: command(),
      kind: "marketing" as const,
      source: "profile" as const,
      textVersion: 1
    });
    await repository.recordConsent({
      accountId,
      request: request("granted"),
      tenantId
    });
    const outcomes = await Promise.allSettled([
      repository.recordConsent({
        accountId,
        request: request("revoked"),
        tenantId
      }),
      repository.recordConsent({
        accountId,
        request: request("granted"),
        tenantId
      })
    ]);
    for (const outcome of outcomes) {
      if (outcome.status === "rejected") {
        expect((outcome.reason as { code?: string }).code).toBe("PT285");
      }
    }
    const events = await admin<{ action: string }[]>`
      select e.action from private.diner_consent_events e
      join private.diner_profile_links l
        on l.tenant_id = e.tenant_id and l.profile_id = e.profile_id
      where l.account_id = ${accountId} and e.kind = 'marketing' order by e.id`;
    const profile = await repository.getProfile({ accountId, tenantId });
    expect(profile.profile?.consents.marketing.granted).toBe(
      events.at(-1)?.action === "granted"
    );
    // Never two grants or two revocations in a row for the same consent.
    for (let i = 1; i < events.length; i += 1) {
      expect(events[i]?.action).not.toBe(events[i - 1]?.action);
    }
  });

  it("anonymizing while linking leaves either a link on an anonymous profile or a refusal", async () => {
    const accountId = await newAccount("carla");
    const repository = database.dinerIdentityRepository;
    const outcomes = await Promise.allSettled([
      repository.anonymize(accountId),
      repository.linkToSession({
        accountId,
        scope: { locationId, tenantId },
        token
      })
    ]);
    const link = outcomes[1];
    if (link?.status === "rejected") {
      expect((link.reason as { code?: string }).code).toBe("PT281");
    }
    const [account] = await admin<
      { email: string | null; google_sub_hash: string | null }[]
    >`select email, google_sub_hash from private.diner_accounts where id = ${accountId}`;
    expect(account).toEqual({ email: null, google_sub_hash: null });
    const [profile] = await admin<{ display_name: string }[]>`
      select p.display_name from private.diner_profiles p
      join private.diner_profile_links l
        on l.tenant_id = p.tenant_id and l.profile_id = p.id
      where l.account_id = ${accountId}`;
    expect(profile?.display_name).toBe("Comensal anonimizado");
  });

  it("redeems a one-time code exactly once under concurrency", async () => {
    const accountId = await newAccount("dario");
    const repository = database.dinerIdentityRepository;
    await repository.createLoginExchange({
      accountId,
      codeHash: sha("one-time"),
      tenantId
    });
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        repository.redeemLogin({
          codeHash: sha("one-time"),
          sessionHash: sha(`session-${index}`),
          tenantId
        })
      )
    );
    expect(results.filter((result) => result === accountId)).toHaveLength(1);
    expect(results.filter((result) => result === null)).toHaveLength(5);
  });
});
