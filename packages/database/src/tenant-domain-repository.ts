import {
  parseTenantHostname,
  type TenantHostContext
} from "@platform/contracts";
import type { Sql } from "postgres";

export interface TenantDomainRepository {
  resolveAdminByHostname(
    hostname: string,
    requesterId: string
  ): Promise<TenantHostContext | null>;
  resolveSoleAdminTenant(
    requesterId: string
  ): Promise<TenantHostContext | null>;
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

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function mapHostRow(row: TenantHostRow | undefined): TenantHostContext | null {
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

export function createTenantDomainRepository(
  client: Sql
): TenantDomainRepository {
  return {
    async resolveAdminByHostname(hostname, requesterId) {
      if (parseTenantHostname(hostname) !== hostname) {
        throw new Error("hostname must be canonical");
      }
      if (!uuidPattern.test(requesterId)) {
        throw new Error("requesterId must be a UUID");
      }

      const [row] = await client<TenantHostRow[]>`
        select *
        from private.resolve_tenant_admin_by_hostname(
          ${hostname},
          ${requesterId}::uuid
        )
      `;
      return mapHostRow(row);
    },
    async resolveSoleAdminTenant(requesterId) {
      if (!uuidPattern.test(requesterId)) {
        throw new Error("requesterId must be a UUID");
      }

      const [row] = await client<TenantHostRow[]>`
        select *
        from private.resolve_sole_tenant_admin(${requesterId}::uuid)
      `;
      return mapHostRow(row);
    },
    async resolveByHostname(hostname) {
      if (parseTenantHostname(hostname) !== hostname) {
        throw new Error("hostname must be canonical");
      }

      const [row] = await client<TenantHostRow[]>`
        select * from private.resolve_tenant_by_hostname(${hostname})
      `;

      return mapHostRow(row);
    }
  };
}
