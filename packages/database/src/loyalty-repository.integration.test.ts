import { createHash } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTenantDatabase, type TenantDatabase } from "./index.js";

const databaseUrl = process.env.DATABASE_URL;
const databaseAdminUrl = process.env.DATABASE_ADMIN_URL ?? databaseUrl;
const describeWithLocalStack =
  databaseUrl && databaseAdminUrl ? describe : describe.skip;

const hex = (value: string) => createHash("sha256").update(value).digest("hex");

describeWithLocalStack("loyalty races against local Supabase", () => {
  const tenantId = "3e200000-0000-4000-8000-000000000001";
  const userId = "3e100000-0000-4000-8000-000000000001";
  const tables = [1, 2, 3, 4, 5, 6].map(
    (n) => `3e600000-0000-4000-8000-00000000000${n}`
  );
  const admin = postgres(databaseAdminUrl ?? "", { prepare: false });
  let database: TenantDatabase;
  let locationId = "";
  let staffId = "";
  const accounts: string[] = [];
  let counter = 0;
  const command = () =>
    `3e700000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
  const scope = () => ({ locationId, tenantId });

  async function newAccount(name: string) {
    const id = await database.dinerIdentityRepository.upsertAccount({
      email: `${name}@example.com`,
      subHash: hex(`${name}-${Date.now()}-${Math.random()}`)
    });
    accounts.push(id);
    await database.dinerIdentityRepository.saveProfile({
      accountId: id,
      request: { displayName: name, whatsappPhone: null },
      tenantId
    });
    return id;
  }

  async function profileOf(accountId: string) {
    const [row] = await admin<{ id: string }[]>`
      select private.diner_profile_id_of(${tenantId}::uuid, ${accountId}::uuid) as id`;
    return row!.id;
  }

  async function openSession(table: string, cents: number, accountId: string) {
    const [session] = await admin<{ id: string }[]>`
      select private.ensure_table_session(
        ${tenantId}::uuid, ${locationId}::uuid, ${table}::uuid, ${staffId}::uuid) as id`;
    const id = session!.id;
    await admin`
      insert into private.account_entries (
        tenant_id, location_id, session_id, kind, amount_cents, origin, cause,
        source_type, source_id, actor_type, actor_id
      ) values (${tenantId}, ${locationId}, ${id}, 'charge', ${cents}, 'manual',
        'Consumo de prueba', 'confirmed_order_item', gen_random_uuid(), 'staff', ${staffId})`;
    await admin`
      insert into private.diner_session_links (tenant_id, location_id, session_id, profile_id)
      values (${tenantId}, ${locationId}, ${id}, ${await profileOf(accountId)})`;
    return id;
  }

  async function settleAndClose(sessionId: string, cents: number) {
    await admin`
      insert into private.account_entries (
        tenant_id, location_id, session_id, kind, amount_cents, origin, cause,
        source_type, source_id, actor_type, actor_id, payment_method
      ) values (${tenantId}, ${locationId}, ${sessionId}, 'payment', ${-cents}, 'payment',
        'Cobro de prueba', 'payment', gen_random_uuid(), 'staff', ${staffId}, 'cash')`;
    return admin`
      select private.close_table_session(
        ${tenantId}::uuid, ${locationId}::uuid, ${staffId}::uuid,
        ${command()}::uuid, ${sessionId}::uuid)`;
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
      await tx`delete from private.cashier_requests where tenant_id = ${tenantId}`;
      await tx`delete from private.account_receipts where tenant_id = ${tenantId}`;
      await tx`delete from private.receipt_counters where tenant_id = ${tenantId}`;
      await tx`delete from private.table_group_events where tenant_id = ${tenantId}`;
      await tx`delete from private.cash_movements where tenant_id = ${tenantId}`;
      await tx`delete from private.cash_shift_closures where tenant_id = ${tenantId}`;
      await tx`delete from private.cash_shifts where tenant_id = ${tenantId}`;
      await tx`delete from private.account_entries where tenant_id = ${tenantId}`;
      await tx`delete from private.account_decisions where tenant_id = ${tenantId}`;
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
      values (${tenantId}, 'loyalty-race', 'Loyalty Race', 'active')`;
    await admin`insert into public.tenant_memberships (tenant_id, user_id, role) values (${tenantId}, ${userId}, 'admin')`;
    const [location] = await admin<{ id: string }[]>`
      select id from public.locations where tenant_id = ${tenantId}`;
    locationId = location!.id;
    const plan = {
      floors: [
        {
          id: "3e400000-0000-4000-8000-000000000001",
          name: "Planta baja",
          position: 0,
          shortName: null
        }
      ],
      groups: [],
      sectors: [
        {
          id: "3e500000-0000-4000-8000-000000000001",
          name: "Salón",
          position: 0
        }
      ],
      tables: tables.map((id, index) => ({
        floorId: "3e400000-0000-4000-8000-000000000001",
        height: 100,
        id,
        label: String(index + 1),
        rotation: 0,
        sectorId: "3e500000-0000-4000-8000-000000000001",
        seatCount: 4,
        seatLayout: "perimeter",
        shape: "square",
        width: 100,
        x: 40 + index * 160,
        y: 40
      }))
    };
    await admin`select private.save_floor_plan(
      ${tenantId}::uuid, ${locationId}::uuid, ${userId}::uuid,
      '3e300000-0000-4000-8000-000000000001'::uuid, 0, ${JSON.stringify(plan)}::text::jsonb)`;
    const [staff] = await admin<{ result: { id: string } }[]>`
      select private.create_staff_member(
        ${tenantId}::uuid, ${locationId}::uuid, ${userId}::uuid,
        'marta', 'Marta', 'manager', 'scrypt-v1$c2FsdA$aGFzaA', '{}'::uuid[]) as result`;
    staffId = staff!.result.id;
    await admin`select private.ensure_payment_methods(${tenantId}::uuid, ${locationId}::uuid)`;
    await admin`select private.open_cash_shift(
      ${tenantId}::uuid, ${locationId}::uuid, ${staffId}::uuid, ${command()}::uuid, 0)`;
    await database.loyaltyRepository.saveSettings({
      scope: scope(),
      settings: {
        birthdayMaxChanges: 1,
        birthdayMinAgeDays: 0,
        enabled: true,
        minSessionMinutes: 0,
        minSpendCents: 0,
        reservationMinutes: 30,
        rewardKind: "percent",
        rewardValidDays: 90,
        rewardValue: 1000,
        visitsGoal: 1
      },
      staffId
    });
  });

  afterAll(async () => {
    await cleanup();
    await admin.end();
    await database.close();
  });

  async function earnReward(accountId: string, table: string) {
    const session = await openSession(table, 10_000, accountId);
    await settleAndClose(session, 10_000);
    const view = await database.loyaltyRepository.getDinerLoyalty({
      accountId,
      scope: scope()
    });
    expect(view.rewards).toHaveLength(1);
    return view.rewards[0]!.rewardId;
  }

  it("lets two accounts of the same day credit a person only once, even if they close at once", async () => {
    const accountId = await newAccount("ana");
    const first = await openSession(tables[0]!, 10_000, accountId);
    const second = await openSession(tables[1]!, 10_000, accountId);
    await Promise.all([
      settleAndClose(first, 10_000),
      settleAndClose(second, 10_000)
    ]);
    const profile = await profileOf(accountId);
    const visits = await admin`
      select count(*)::int as count from private.loyalty_visits
      where tenant_id = ${tenantId} and profile_id = ${profile} and status = 'credited'`;
    expect(visits[0]?.count).toBe(1);
    const rewards = await admin`
      select count(*)::int as count from private.loyalty_rewards
      where tenant_id = ${tenantId} and profile_id = ${profile}`;
    expect(rewards[0]?.count).toBe(1);
  });

  it("redeems a reward exactly once when it is used many times at once", async () => {
    const accountId = await newAccount("beto");
    const rewardId = await earnReward(accountId, tables[2]!);
    const session = await openSession(tables[3]!, 20_000, accountId);
    await database.loyaltyRepository.reserveReward({
      accountId,
      request: { rewardId, sessionId: session },
      scope: scope()
    });
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        database.loyaltyRepository.redeemReward({
          request: {
            commandId: command(),
            method: "cash",
            rewardId,
            tipCents: 0
          },
          scope: scope(),
          sessionId: session,
          staffId
        })
      )
    );
    const redeemed = results.filter(
      (result) => result.status === "fulfilled" && result.value.redeemed
    );
    expect(redeemed).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected")
    ).toHaveLength(5);
    const discounts = await admin`
      select count(*)::int as count from private.account_entries
      where tenant_id = ${tenantId} and session_id = ${session} and kind = 'discount'`;
    expect(discounts[0]?.count).toBe(1);
    const [status] = await admin`
      select status from private.loyalty_rewards where tenant_id = ${tenantId} and id = ${rewardId}`;
    expect(status?.status).toBe("redeemed");
  });

  it("never loses a reward when the payment fails while the diner reserves again", async () => {
    const accountId = await newAccount("carla");
    const rewardId = await earnReward(accountId, tables[4]!);
    const session = await openSession(tables[5]!, 20_000, accountId);
    await database.loyaltyRepository.reserveReward({
      accountId,
      request: { rewardId, sessionId: session },
      scope: scope()
    });
    const [failed, release] = await Promise.allSettled([
      // A payment method the till does not know: the payment cannot be recorded.
      admin`select private.redeem_loyalty_reward_with_payment(
        ${tenantId}::uuid, ${locationId}::uuid, ${staffId}::uuid, ${command()}::uuid,
        ${session}::uuid, ${rewardId}::uuid, 'bogus_method', 0)`,
      database.loyaltyRepository.releaseReward({
        accountId,
        request: { rewardId },
        scope: scope()
      })
    ]);
    // Whichever goes first, one of them is a clean no-op and the other leaves it available.
    expect(release.status).toBe("fulfilled");
    expect(["fulfilled", "rejected"]).toContain(failed.status);
    const [row] = await admin`
      select status from private.loyalty_rewards where tenant_id = ${tenantId} and id = ${rewardId}`;
    expect(row?.status).toBe("available");
    const discounts = await admin`
      select count(*)::int as count from private.account_entries
      where tenant_id = ${tenantId} and session_id = ${session} and kind = 'discount'`;
    expect(discounts[0]?.count).toBe(0);
  });
});
