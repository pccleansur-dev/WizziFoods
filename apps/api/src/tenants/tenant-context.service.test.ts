import { describe, expect, it } from "vitest";

import { TenantContextService } from "./tenant-context.service.js";

describe("TenantContextService", () => {
  it("keeps a platform superadmin outside tenant operation", async () => {
    const service = new TenantContextService(
      {
        resolveForIdentity: async () => ({ type: "platform_superadmin" })
      },
      {
        activateForIdentity: async () => false,
        begin: async () => {
          throw new Error("not used");
        },
        complete: async () => {
          throw new Error("not used");
        }
      }
    );

    await expect(
      service.getForAuthenticatedIdentity(
        "10000000-0000-4000-8000-000000000001",
        "70000000-0000-4000-8000-000000000007"
      )
    ).resolves.toEqual({ type: "platform_superadmin" });
  });

  it("rejects a revoked administrative session", async () => {
    const service = new TenantContextService(
      { resolveForIdentity: async () => null },
      {
        activateForIdentity: async () => false,
        begin: async () => {
          throw new Error("not used");
        },
        complete: async () => {
          throw new Error("not used");
        }
      }
    );

    await expect(
      service.getForAuthenticatedIdentity(
        "10000000-0000-4000-8000-000000000001",
        "70000000-0000-4000-8000-000000000007"
      )
    ).rejects.toMatchObject({ status: 401 });
  });

  it("activates an invited administrator after its first valid access", async () => {
    let activatedUserId: string | undefined;
    const service = new TenantContextService(
      {
        resolveForIdentity: async () => ({
          tenantContexts: [],
          type: "tenant_admin"
        })
      },
      {
        activateForIdentity: async (userId) => {
          activatedUserId = userId;
          return true;
        },
        begin: async () => {
          throw new Error("not used");
        },
        complete: async () => {
          throw new Error("not used");
        }
      }
    );

    await service.getForAuthenticatedIdentity(
      "10000000-0000-4000-8000-000000000001",
      "70000000-0000-4000-8000-000000000007"
    );

    expect(activatedUserId).toBe("10000000-0000-4000-8000-000000000001");
  });
});
