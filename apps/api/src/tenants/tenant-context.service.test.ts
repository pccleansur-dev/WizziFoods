import { describe, expect, it } from "vitest";

import { TenantContextService } from "./tenant-context.service.js";

describe("TenantContextService", () => {
  it("keeps a platform superadmin outside tenant operation", async () => {
    const service = new TenantContextService({
      resolveForIdentity: async () => ({ type: "platform_superadmin" })
    });

    await expect(
      service.getForAuthenticatedIdentity(
        "10000000-0000-4000-8000-000000000001"
      )
    ).resolves.toEqual({ type: "platform_superadmin" });
  });
});
