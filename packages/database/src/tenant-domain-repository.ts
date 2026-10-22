import {
  parseTenantHostname,
  type TenantHostContext
} from "@platform/contracts";
import type { Sql } from "postgres";

export interface TenantDomainRepository {
  resolveByHostname(hostname: string): Promise<TenantHostContext | null>;
}

type TenantHostRow = {
  domain_id: string;
  hostname: string;
  location_id: string;
  location_name: string;
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
};

export function createTenantDomainRepository(
  client: Sql
): TenantDomainRepository {
  return {
    async resolveByHostname(hostname) {
      if (parseTenantHostname(hostname) !== hostname) {
        throw new Error("hostname must be canonical");
      }

      const [row] = await client<TenantHostRow[]>`
        select * from private.resolve_tenant_by_hostname(${hostname})
      `;

      return row
        ? {
            domain: { hostname: row.hostname, id: row.domain_id },
            location: { id: row.location_id, name: row.location_name },
            tenant: {
              id: row.tenant_id,
              name: row.tenant_name,
              slug: row.tenant_slug
            }
          }
        : null;
    }
  };
}
