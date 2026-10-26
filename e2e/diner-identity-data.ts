import postgres from "postgres";

import {
  seedBusiness,
  tables,
  tenantId,
  userId,
  type SeededBusiness
} from "./table-entry-data";
import { ownerDatabaseUrl } from "./stack-env";

const staffId = "fe900000-0000-4000-8000-000000000001";

export type DinerBusiness = SeededBusiness & {
  accountByEmail(email: string): Promise<{
    anonymizedAt: Date | null;
    email: string | null;
    hasSubHash: boolean;
  } | null>;
  consentActions(displayName: string): Promise<string[]>;
  linkedSessions(displayName: string): Promise<string[]>;
  /** Opens (or joins) the account of the group or table, as the waiter would. */
  openSession(tableId: string): Promise<string>;
  profileNames(): Promise<string[]>;
};

/** Removes everything diners created, before the business itself goes away. */
async function cleanupDiners(owner: postgres.Sql) {
  await owner.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    const owned = await tx<
      { account_id: string }[]
    >`select account_id from private.diner_profile_links where tenant_id = ${tenantId}`;
    await tx`delete from private.diner_session_links where tenant_id = ${tenantId}`;
    await tx`delete from private.diner_consent_events where tenant_id = ${tenantId}`;
    await tx`delete from private.diner_profile_links where tenant_id = ${tenantId}`;
    await tx`delete from private.diner_profiles where tenant_id = ${tenantId}`;
    await tx`delete from private.diner_sessions where tenant_id = ${tenantId}`;
    await tx`delete from private.diner_login_exchanges where tenant_id = ${tenantId}`;
    await tx`delete from private.diner_accounts where id = any(${owned.map((row) => row.account_id)}::uuid[])`;
    await tx`delete from private.table_sessions where tenant_id = ${tenantId}`;
  });
}

export async function seedDinerBusiness(): Promise<DinerBusiness> {
  const owner = postgres(ownerDatabaseUrl(), { prepare: false });
  // Leftovers of a crashed run would block removing the previous business.
  await cleanupDiners(owner);
  const base = await seedBusiness();
  const [location] = await owner<{ id: string }[]>`
    select id from public.locations where tenant_id = ${tenantId}`;
  const locationId = location!.id;
  await owner`
    insert into public.staff_members (
      id, tenant_id, location_id, username, display_name, role, created_by
    ) values (
      ${staffId}, ${tenantId}, ${locationId}, 'marta', 'Marta', 'manager', ${userId})
    on conflict do nothing`;
  return {
    ...base,
    async accountByEmail(email) {
      const [row] = await owner<
        {
          anonymized_at: Date | null;
          email: string | null;
          has_sub: boolean;
        }[]
      >`
        select anonymized_at, email, google_sub_hash is not null as has_sub
        from private.diner_accounts where email = ${email}`;
      return row
        ? {
            anonymizedAt: row.anonymized_at,
            email: row.email,
            hasSubHash: row.has_sub
          }
        : null;
    },
    async close() {
      await cleanupDiners(owner);
      await owner`delete from public.staff_members where id = ${staffId}`;
      await owner.end();
      await base.close();
    },
    async consentActions(displayName) {
      const rows = await owner<{ action: string; kind: string }[]>`
        select e.kind, e.action from private.diner_consent_events e
        join private.diner_profiles p
          on p.tenant_id = e.tenant_id and p.id = e.profile_id
        where e.tenant_id = ${tenantId}
          and (p.display_name = ${displayName}
            or (p.anonymized_at is not null and ${displayName} = ''))
        order by e.id`;
      return rows.map((row) => `${row.kind}:${row.action}`);
    },
    async linkedSessions(displayName) {
      const rows = await owner<{ session_id: string }[]>`
        select l.session_id from private.diner_session_links l
        join private.diner_profiles p
          on p.tenant_id = l.tenant_id and p.id = l.profile_id
        where l.tenant_id = ${tenantId} and p.display_name = ${displayName}`;
      return rows.map((row) => row.session_id);
    },
    async openSession(tableId) {
      const [row] = await owner<{ id: string }[]>`
        select private.ensure_table_session(
          ${tenantId}::uuid, ${locationId}::uuid, ${tableId}::uuid, ${staffId}::uuid
        ) as id`;
      return row!.id;
    },
    async profileNames() {
      const rows = await owner<{ display_name: string }[]>`
        select display_name from private.diner_profiles
        where tenant_id = ${tenantId} order by created_at`;
      return rows.map((row) => row.display_name);
    }
  };
}

export { tables };
