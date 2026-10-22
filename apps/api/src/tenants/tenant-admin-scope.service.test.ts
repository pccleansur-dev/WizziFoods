import { ForbiddenException, NotFoundException } from "@nestjs/common";
import type { TenantHostContext } from "@platform/contracts";
import { describe, expect, it } from "vitest";

import type { AdminIdentity } from "../auth/admin-auth.service.js";
import { TenantAdminScopeService } from "./tenant-admin-scope.service.js";

const identity: AdminIdentity = {
  assuranceLevel: "aal2",
  sessionId: "97000000-0000-4000-8000-000000000097",
  userId: "96000000-0000-4000-8000-000000000096"
};
const hostContext: TenantHostContext = {
  domain: {
    hostname: "tenant-a.plataforma.test",
    id: "98000000-0000-4000-8000-000000000098"
  },
  location: {
    id: "92000000-0000-4000-8000-000000000092",
    name: "Principal"
  },
  tenant: {
    id: "91000000-0000-4000-8000-000000000091",
    name: "Tenant A",
    slug: "tenant-a"
  }
};

describe("TenantAdminScopeService", () => {
  it("derives scope only when identity and hostname select the same tenant", async () => {
    const service = new TenantAdminScopeService({
      getForAuthenticatedIdentity: async () => ({
        tenantContexts: [
          {
            location: hostContext.location,
            role: "admin",
            tenant: { ...hostContext.tenant, status: "active" }
          }
        ],
        type: "tenant_admin"
      })
    });

    await expect(service.resolve(identity, hostContext)).resolves.toMatchObject(
      {
        identity: { userId: identity.userId },
        role: "admin",
        scope: {
          locationId: hostContext.location.id,
          tenantId: hostContext.tenant.id
        },
        tenant: { slug: "tenant-a" }
      }
    );
  });

  it("fails closed when an administrator changes to another tenant host", async () => {
    const service = new TenantAdminScopeService({
      getForAuthenticatedIdentity: async () => ({
        tenantContexts: [
          {
            location: {
              id: "99000000-0000-4000-8000-000000000099",
              name: "Principal"
            },
            role: "admin",
            tenant: {
              id: "93000000-0000-4000-8000-000000000093",
              name: "Tenant B",
              slug: "tenant-b",
              status: "active"
            }
          }
        ],
        type: "tenant_admin"
      })
    });

    await expect(service.resolve(identity, hostContext)).rejects.toBeInstanceOf(
      NotFoundException
    );
  });

  it("does not let a platform superadmin silently enter a tenant", async () => {
    const service = new TenantAdminScopeService({
      getForAuthenticatedIdentity: async () => ({
        type: "platform_superadmin"
      })
    });

    await expect(service.resolve(identity, hostContext)).rejects.toBeInstanceOf(
      ForbiddenException
    );
  });
});
