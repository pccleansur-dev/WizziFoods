import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { locations, tenantMemberships, tenants } from "./schema.js";

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

export type TenantDatabase = {
  close(): Promise<void>;
  tenantRepository: TenantRepository;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function createTenantDatabase(databaseUrl: string): TenantDatabase {
  const client = postgres(databaseUrl, { max: 10, prepare: false });
  const database = drizzle(client);

  return {
    close: async () => client.end(),
    tenantRepository: {
      async findForIdentity(userId: string): Promise<TenantContext[]> {
        if (!uuidPattern.test(userId)) {
          throw new Error("userId must be a UUID");
        }

        return database.transaction(async (transaction) => {
          await transaction.execute(
            sql`select set_config('request.jwt.claim.sub', ${userId}, true)`
          );
          await transaction.execute(sql.raw("set local role authenticated"));

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
              and(
                eq(locations.tenantId, tenants.id),
                eq(locations.isPrimary, true)
              )
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
        });
      }
    }
  };
}
