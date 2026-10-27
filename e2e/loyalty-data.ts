import postgres from "postgres";

import {
  seedAdjustmentsBusiness,
  adjustmentsSlug,
  type AdjustmentsBusiness
} from "./adjustments-data";
import { ownerDatabaseUrl } from "./stack-env";

export type LoyaltyBusiness = AdjustmentsBusiness & {
  /** Discounts written in the ledger, in cents (negative), oldest first. */
  discounts(): Promise<number[]>;
  /**
   * A finished visit of someone with a profile: opens an account on table 6, consumes,
   * pays, closes (which credits the visit) and dates the opening some days back.
   */
  completeVisit(
    displayName: string,
    options: { cents: number; daysAgo: number }
  ): Promise<void>;
  rewardStatuses(displayName: string): Promise<string[]>;
  visits(displayName: string): Promise<string[]>;
};

async function cleanupLoyalty(owner: postgres.Sql) {
  const [tenant] = await owner<{ id: string }[]>`
    select id from public.tenants where slug = ${adjustmentsSlug}`;
  if (!tenant) return;
  await owner.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    const created = await tx<
      { account_id: string }[]
    >`select account_id from private.diner_profile_links where tenant_id = ${tenant.id}`;
    for (const table of [
      "messaging_events",
      "messaging_outbox",
      "messaging_automations",
      "whatsapp_templates",
      "whatsapp_connections",
      "loyalty_visits",
      "loyalty_rewards",
      "diner_birthdays",
      "loyalty_settings",
      "diner_session_links",
      "diner_consent_events",
      "diner_profile_links",
      "diner_profiles",
      "diner_sessions",
      "diner_login_exchanges",
      "table_group_events"
    ]) {
      await tx`delete from ${tx(`private.${table}`)} where tenant_id = ${tenant.id}`;
    }
    await tx`delete from private.diner_accounts where id = any(${created.map((row) => row.account_id)}::uuid[])`;
  });
}

/**
 * The adjustments business (waiter, manager, open register, tables 5 and 6) with a
 * loyalty program of one visit per reward and a 10% reward.
 */
export async function seedLoyaltyBusiness(): Promise<LoyaltyBusiness> {
  const owner = postgres(ownerDatabaseUrl(), { prepare: false });
  await cleanupLoyalty(owner);
  const base = await seedAdjustmentsBusiness({ openRegister: true });
  const [tenant] = await owner<{ id: string }[]>`
    select id from public.tenants where slug = ${adjustmentsSlug}`;
  const tenantId = tenant!.id;
  const [location] = await owner<{ id: string }[]>`
    select id from public.locations where tenant_id = ${tenantId}`;
  const locationId = location!.id;
  const [manager] = await owner<{ id: string }[]>`
    select id from public.staff_members
    where tenant_id = ${tenantId} and username = 'marta'`;
  const [tableSix] = await owner<{ id: string }[]>`
    select id from private.floor_tables
    where tenant_id = ${tenantId} and label = '6'`;
  await owner`
    insert into private.loyalty_settings (
      tenant_id, location_id, enabled, min_spend_cents, visits_goal,
      reward_kind, reward_value, birthday_min_age_days
    ) values (${tenantId}, ${locationId}, true, 0, 1, 'percent', 1000, 0)`;

  return {
    ...base,
    async close() {
      await cleanupLoyalty(owner);
      await base.close();
      await owner.end();
    },
    async completeVisit(displayName, { cents, daysAgo }) {
      const [profile] = await owner<{ id: string }[]>`
        select id from private.diner_profiles
        where tenant_id = ${tenantId} and display_name = ${displayName}
        order by created_at desc limit 1`;
      const [session] = await owner<{ id: string }[]>`
        select private.ensure_table_session(
          ${tenantId}::uuid, ${locationId}::uuid, ${tableSix!.id}::uuid, ${manager!.id}::uuid
        ) as id`;
      const sessionId = session!.id;
      await owner`
        insert into private.account_entries (
          tenant_id, location_id, session_id, kind, amount_cents, origin, cause,
          source_type, source_id, actor_type, actor_id
        ) values (${tenantId}, ${locationId}, ${sessionId}, 'charge', ${cents}, 'manual',
          'Visita anterior', 'confirmed_order_item', gen_random_uuid(), 'staff', ${manager!.id})`;
      await owner`
        insert into private.diner_session_links (tenant_id, location_id, session_id, profile_id)
        values (${tenantId}, ${locationId}, ${sessionId}, ${profile!.id})`;
      await owner.begin(async (tx) => {
        await tx`set local session_replication_role = replica`;
        await tx`
          update private.table_sessions
          set opened_at = now() - make_interval(days => ${daysAgo})
          where tenant_id = ${tenantId} and id = ${sessionId}`;
      });
      await owner`
        insert into private.account_entries (
          tenant_id, location_id, session_id, kind, amount_cents, origin, cause,
          source_type, source_id, actor_type, actor_id, payment_method
        ) values (${tenantId}, ${locationId}, ${sessionId}, 'payment', ${-cents}, 'payment',
          'Cobro anterior', 'payment', gen_random_uuid(), 'staff', ${manager!.id}, 'cash')`;
      await owner`
        select private.close_table_session(
          ${tenantId}::uuid, ${locationId}::uuid, ${manager!.id}::uuid,
          gen_random_uuid(), ${sessionId}::uuid)`;
      // Leave table 6 reusable for the next visit.
      await owner`
        select private.mark_table_clean(
          ${tenantId}::uuid, ${locationId}::uuid, ${manager!.id}::uuid,
          gen_random_uuid(), ${tableSix!.id}::uuid)`;
    },
    async discounts() {
      const rows = await owner<{ amount: number }[]>`
        select amount_cents as amount from private.account_entries
        where tenant_id = ${tenantId} and kind = 'discount' order by id`;
      return rows.map((row) => row.amount);
    },
    async rewardStatuses(displayName) {
      const rows = await owner<{ status: string }[]>`
        select r.status from private.loyalty_rewards r
        join private.diner_profiles p on p.tenant_id = r.tenant_id and p.id = r.profile_id
        where r.tenant_id = ${tenantId} and p.display_name = ${displayName}
        order by r.granted_at, r.id`;
      return rows.map((row) => row.status);
    },
    async visits(displayName) {
      const rows = await owner<{ status: string }[]>`
        select v.status from private.loyalty_visits v
        join private.diner_profiles p on p.tenant_id = v.tenant_id and p.id = v.profile_id
        where v.tenant_id = ${tenantId} and p.display_name = ${displayName}
        order by v.created_at, v.id`;
      return rows.map((row) => row.status);
    }
  };
}
