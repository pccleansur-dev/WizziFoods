import type { TenantContext } from "@platform/database";
import { describe, expect, it } from "vitest";

import type { AdminIdentity } from "../auth/admin-auth.service.js";
import { TenantContextController } from "./tenant-context.controller.js";
import { TenantContextService } from "./tenant-context.service.js";

describe("TenantContextController", () => {
  it("returns context derived from the verified request identity", async () => {
    const identity: AdminIdentity = {
      assuranceLevel: "aal2",
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
      findForIdentity: async () => [tenantContext]
    });
    const controller = new TenantContextController(service);

    await expect(
      controller.getTenantContext({ adminIdentity: identity })
    ).resolves.toEqual({
      data: {
        identity,
        tenantContexts: [tenantContext]
      }
    });
  });
});
