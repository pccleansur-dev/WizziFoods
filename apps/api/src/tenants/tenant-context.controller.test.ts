import type { TenantContext } from "@platform/database";
import { SELF_DECLARED_DEPS_METADATA } from "@nestjs/common/constants.js";
import { describe, expect, it } from "vitest";

import type { AdminIdentity } from "../auth/admin-auth.service.js";
import { TenantContextController } from "./tenant-context.controller.js";
import { TenantContextService } from "./tenant-context.service.js";

describe("TenantContextController", () => {
  it("declares its tenant service dependency explicitly", () => {
    expect(
      Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, TenantContextController)
    ).toEqual([{ index: 0, param: TenantContextService }]);
  });

  it("returns context derived from the verified request identity", async () => {
    const identity: AdminIdentity = {
      assuranceLevel: "aal2",
      sessionId: "70000000-0000-4000-8000-000000000007",
      userId: "10000000-0000-4000-8000-000000000001"
    };
    const tenantContext: TenantContext = {
      location: { id: "location-a", name: "Principal" },
      role: "admin",
      tenant: {
        id: "tenant-a",
        name: "Tenant A",
        slug: "tenant-a",
        status: "active"
      }
    };
    const service = new TenantContextService({
      resolveForIdentity: async () => ({
        tenantContexts: [tenantContext],
        type: "tenant_admin"
      })
    });
    const controller = new TenantContextController(service);

    await expect(
      controller.getAccess({ adminIdentity: identity })
    ).resolves.toEqual({
      data: {
        identity: {
          assuranceLevel: "aal2",
          userId: identity.userId
        },
        access: {
          tenantContexts: [tenantContext],
          type: "tenant_admin"
        }
      }
    });
  });
});
