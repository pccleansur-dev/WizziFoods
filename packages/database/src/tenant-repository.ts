import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import {
  locations,
  platformSuperadmins,
  tenantMemberships,
  tenants
} from "./schema.js";

export type TenantContext = {
  location: {
    id: string;
    name: string;
  };
  role: "admin";
  tenant: {
    id: string;
    name: string;
    slug: string;
    status: "active" | "draft" | "suspended";
  };
};

export interface TenantRepository {
  findForIdentity(userId: string): Promise<TenantContext[]>;
}

export type IdentityAccess =
  | { type: "platform_superadmin" }
  | { tenantContexts: TenantContext[]; type: "tenant_admin" }
  | { type: "unassigned" };

export interface IdentityAccessRepository {
  resolveForIdentity(userId: string): Promise<IdentityAccess>;
}

export type TenantDatabase = {
  close(): Promise<void>;
  identityAccessRepository: IdentityAccessRepository;
  tenantRepository: TenantRepository;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function assertUserId(userId: string): void {
  if (!uuidPattern.test(userId)) {
    throw new Error("userId must be a UUID");
  }
}

export function createTenantDatabase(databaseUrl: string): TenantDatabase {
  const client = postgres(databaseUrl, { max: 10, prepare: false });
  const database = drizzle(client);
  type Transaction = Parameters<Parameters<typeof database.transaction>[0]>[0];

  async function assumeAuthenticatedIdentity(
    transaction: Transaction,
    userId: string
  ): Promise<void> {
    await transaction.execute(
      sql`select set_config('request.jwt.claim.sub', ${userId}, true)`
    );
    await transaction.execute(sql.raw("set local role authenticated"));
  }

  async function queryTenantContexts(
    transaction: Transaction,
    userId: string
  ): Promise<TenantContext[]> {
    const rows = await transaction
      .select({
        locationId: locations.id,
        locationName: locations.name,
        role: tenantMemberships.role,
        tenantId: tenants.id,
        tenantName: tenants.name,
        tenantSlug: tenants.slug,
        tenantStatus: tenants.status
      })
      .from(tenantMemberships)
      .innerJoin(tenants, eq(tenants.id, tenantMemberships.tenantId))
      .innerJoin(
        locations,
        and(eq(locations.tenantId, tenants.id), eq(locations.isPrimary, true))
      )
      .where(eq(tenantMemberships.userId, userId));

    return rows.map((row) => ({
      location: { id: row.locationId, name: row.locationName },
      role: row.role,
      tenant: {
        id: row.tenantId,
        name: row.tenantName,
        slug: row.tenantSlug,
        status: row.tenantStatus
      }
    }));
  }

  return {
    close: async () => client.end(),
    identityAccessRepository: {
      async resolveForIdentity(userId: string): Promise<IdentityAccess> {
        assertUserId(userId);

        return database.transaction(async (transaction) => {
          await assumeAuthenticatedIdentity(transaction, userId);
          const [platformAssignment] = await transaction
            .select({ userId: platformSuperadmins.userId })
            .from(platformSuperadmins)
            .where(eq(platformSuperadmins.userId, userId))
            .limit(1);

          if (platformAssignment) {
            return { type: "platform_superadmin" };
          }

          const tenantContexts = await queryTenantContexts(transaction, userId);
          return tenantContexts.length > 0
            ? { tenantContexts, type: "tenant_admin" }
            : { type: "unassigned" };
        });
      }
    },
    tenantRepository: {
      async findForIdentity(userId: string): Promise<TenantContext[]> {
        assertUserId(userId);

        return database.transaction(async (transaction) => {
          await assumeAuthenticatedIdentity(transaction, userId);
          return queryTenantContexts(transaction, userId);
        });
      }
    }
  };
}
