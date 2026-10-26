import postgres from "postgres";

import {
  adjustmentsSlug,
  seedAdjustmentsBusiness,
  type AdjustmentsBusiness
} from "./adjustments-data";
import { ownerDatabaseUrl } from "./stack-env";

export type MessagingBusiness = AdjustmentsBusiness & {
  /** Status of the outbox messages of a person, oldest first. */
  outbox(
    displayName: string
  ): Promise<{ lastError: string | null; status: string }[]>;
  /** The marketing consent of a person and the origin of its last change. */
  marketing(displayName: string): Promise<{ granted: boolean; source: string }>;
  /** How many sealed credentials exist for the business (0 or 1). */
  connections(): Promise<number>;
  /** The credential bytes, to prove the token is not stored in clear. */
  storedCredential(): Promise<Buffer | null>;
  /** Active browsers of a person. */
  pushSubscriptions(displayName: string): Promise<number>;
  /** Messages of a person by channel and status, oldest first. */
  channelOutbox(
    displayName: string
  ): Promise<{ channel: string; status: string }[]>;
  /** Adds an active browser to a person, as if they had turned notifications on. */
  subscribePush(displayName: string, endpoint: string): Promise<void>;
  /** A diner with a profile, a phone and both consents. */
  newDiner(displayName: string, phone: string): Promise<void>;
};

async function cleanupMessaging(owner: postgres.Sql) {
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
      "push_subscriptions",
      "push_settings",
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
 * The adjustments business (manager Marta, waiter Ana) with no WhatsApp connection yet,
 * and one diner who agreed to be contacted. Real sending is never switched on here:
 * the journey ends in the log, not in a phone.
 */
export async function seedMessagingBusiness(): Promise<MessagingBusiness> {
  const owner = postgres(ownerDatabaseUrl(), { prepare: false });
  await cleanupMessaging(owner);
  const base = await seedAdjustmentsBusiness({ openRegister: false });
  const [tenant] = await owner<{ id: string }[]>`
    select id from public.tenants where slug = ${adjustmentsSlug}`;
  const tenantId = tenant!.id;
  let counter = 0;
  const hashes: string[] = [];

  return {
    ...base,
    async close() {
      await cleanupMessaging(owner);
      await base.close();
      await owner.end();
    },
    async connections() {
      const [row] = await owner<{ total: number }[]>`
        select count(*)::int as total from private.whatsapp_connections
        where tenant_id = ${tenantId}`;
      return row!.total;
    },
    async marketing(displayName) {
      const [row] = await owner<{ action: string; source: string }[]>`
        select e.action, e.source from private.diner_consent_events e
        join private.diner_profiles p on p.tenant_id = e.tenant_id and p.id = e.profile_id
        where e.tenant_id = ${tenantId} and p.display_name = ${displayName}
          and e.kind = 'marketing'
        order by e.id desc limit 1`;
      return { granted: row?.action === "granted", source: row?.source ?? "" };
    },
    async newDiner(displayName, phone) {
      counter += 1;
      const hash = `${String(counter).padStart(2, "0")}${"ab".repeat(31)}`;
      hashes.push(hash);
      const [account] = await owner<{ id: string }[]>`
        select private.upsert_diner_account(${hash}, ${`msg${counter}@example.com`}) as id`;
      await owner`
        select private.save_diner_profile(
          ${tenantId}::uuid, ${account!.id}::uuid, ${displayName}, ${phone})`;
      for (const kind of ["whatsapp_verified", "marketing"]) {
        await owner`
          select private.record_diner_consent(
            ${tenantId}::uuid, ${account!.id}::uuid, gen_random_uuid(),
            ${kind}::text, 'granted', 1, 'profile')`;
      }
    },
    async outbox(displayName) {
      const rows = await owner<{ last_error: string | null; status: string }[]>`
        select o.status, o.last_error from private.messaging_outbox o
        join private.diner_profiles p on p.tenant_id = o.tenant_id and p.id = o.profile_id
        where o.tenant_id = ${tenantId} and p.display_name = ${displayName}
        order by o.created_at, o.id`;
      return rows.map((row) => ({
        lastError: row.last_error,
        status: row.status
      }));
    },
    async pushSubscriptions(displayName) {
      const [row] = await owner<{ total: number }[]>`
        select count(*)::int as total from private.push_subscriptions s
        join private.diner_profiles p on p.tenant_id = s.tenant_id and p.id = s.profile_id
        where s.tenant_id = ${tenantId} and p.display_name = ${displayName}
          and s.revoked_at is null`;
      return row!.total;
    },
    async channelOutbox(displayName) {
      return owner<{ channel: string; status: string }[]>`
        select o.channel, o.status from private.messaging_outbox o
        join private.diner_profiles p on p.tenant_id = o.tenant_id and p.id = o.profile_id
        where o.tenant_id = ${tenantId} and p.display_name = ${displayName}
        order by o.created_at, o.id`;
    },
    async subscribePush(displayName, endpoint) {
      await owner`
        insert into private.push_subscriptions (tenant_id, profile_id, endpoint, p256dh, auth)
        select p.tenant_id, p.id, ${endpoint}, ${"A".repeat(87)}, ${"B".repeat(22)}
        from private.diner_profiles p
        where p.tenant_id = ${tenantId} and p.display_name = ${displayName}`;
    },
    async storedCredential() {
      const [row] = await owner<{ ciphertext: Buffer }[]>`
        select ciphertext from private.whatsapp_connections where tenant_id = ${tenantId}`;
      return row?.ciphertext ?? null;
    }
  };
}
