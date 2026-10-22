import { describe, expect, it, vi } from "vitest";

import { TenantSuspensionService } from "./tenant-suspension.service.js";

const identity = {
  assuranceLevel: "aal2" as const,
  sessionId: "70000000-0000-4000-8000-000000000007",
  userId: "71000000-0000-4000-8000-000000000071"
};
const request = {
  mode: "commercial" as const,
  reason: "Subscription period ended"
};

describe("TenantSuspensionService", () => {
  it("suspends through the repository for a platform superadministrator", async () => {
    const suspend = vi.fn(async () => ({
      completedAt: null,
      mode: "commercial" as const,
      phase: "commercial_draining" as const,
      requestedAt: "2026-10-22T15:30:00.000Z",
      tenantStatus: "active" as const
    }));
    const service = new TenantSuspensionService(
      { resolveForIdentity: async () => ({ type: "platform_superadmin" }) },
      { request: suspend }
    );

    await expect(
      service.request(
        identity,
        "74000000-0000-4000-8000-000000000074",
        request,
        "suspension-commercial-001"
      )
    ).resolves.toMatchObject({ phase: "commercial_draining" });
    expect(suspend).toHaveBeenCalledWith({
      actorUserId: identity.userId,
      correlationId: "suspension-commercial-001",
      ...request,
      tenantId: "74000000-0000-4000-8000-000000000074"
    });
  });

  it("rejects a tenant administrator", async () => {
    const service = new TenantSuspensionService(
      {
        resolveForIdentity: async () => ({
          tenantContexts: [],
          type: "tenant_admin"
        })
      },
      { request: vi.fn() }
    );

    await expect(
      service.request(
        identity,
        "74000000-0000-4000-8000-000000000074",
        request,
        "suspension-commercial-001"
      )
    ).rejects.toMatchObject({ status: 403 });
  });

  it("rejects a revoked platform session", async () => {
    const service = new TenantSuspensionService(
      { resolveForIdentity: async () => null },
      { request: vi.fn() }
    );

    await expect(
      service.request(
        identity,
        "74000000-0000-4000-8000-000000000074",
        request,
        "suspension-commercial-001"
      )
    ).rejects.toMatchObject({ status: 401 });
  });
});
