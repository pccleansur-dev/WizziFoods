import type { TenantProvisioningRecord } from "@platform/database";
import { describe, expect, it, vi } from "vitest";

import { TenantProvisioningService } from "./tenant-provisioning.service.js";

const identity = {
  assuranceLevel: "aal2" as const,
  sessionId: "70000000-0000-4000-8000-000000000007",
  userId: "71000000-0000-4000-8000-000000000071"
};
const pending: TenantProvisioningRecord = {
  adminEmail: "owner@example.com",
  authUserId: null,
  location: { id: "72000000-0000-4000-8000-000000000072", name: "Principal" },
  requestId: "73000000-0000-4000-8000-000000000073",
  status: "pending_invitation",
  tenant: {
    id: "74000000-0000-4000-8000-000000000074",
    name: "Café Norte",
    slug: "cafe-norte"
  }
};
const request = {
  adminEmail: "owner@example.com",
  name: "Café Norte",
  slug: "cafe-norte"
};

describe("TenantProvisioningService", () => {
  it("creates and completes one administrator invitation", async () => {
    const invite = vi.fn(async () => ({
      userId: "75000000-0000-4000-8000-000000000075"
    }));
    const complete = vi.fn(async () => ({
      ...pending,
      authUserId: "75000000-0000-4000-8000-000000000075",
      status: "invited" as const
    }));
    const service = new TenantProvisioningService(
      { resolveForIdentity: async () => ({ type: "platform_superadmin" }) },
      { begin: async () => pending, complete },
      { invite },
      "https://app.example.test/auth/callback"
    );

    await expect(
      service.create(identity, "request-1", request)
    ).resolves.toEqual({
      adminEmail: pending.adminEmail,
      location: pending.location,
      requestId: pending.requestId,
      status: "invited",
      tenant: pending.tenant
    });
    expect(invite).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenCalledWith({
      actorUserId: identity.userId,
      authUserId: "75000000-0000-4000-8000-000000000075",
      requestId: pending.requestId
    });
  });

  it("does not send another invitation after a completed retry", async () => {
    const invite = vi.fn();
    const service = new TenantProvisioningService(
      { resolveForIdentity: async () => ({ type: "platform_superadmin" }) },
      {
        begin: async () => ({
          ...pending,
          authUserId: "75000000-0000-4000-8000-000000000075",
          status: "invited"
        }),
        complete: async () => pending
      },
      { invite },
      "https://app.example.test/auth/callback"
    );

    await expect(
      service.create(identity, "request-1", request)
    ).resolves.toMatchObject({
      status: "invited"
    });
    expect(invite).not.toHaveBeenCalled();
  });

  it("rejects an active tenant administrator", async () => {
    const service = new TenantProvisioningService(
      {
        resolveForIdentity: async () => ({
          tenantContexts: [],
          type: "tenant_admin"
        })
      },
      { begin: async () => pending, complete: async () => pending },
      { invite: async () => ({ userId: identity.userId }) },
      "https://app.example.test/auth/callback"
    );

    await expect(
      service.create(identity, "request-1", request)
    ).rejects.toMatchObject({
      status: 403
    });
  });

  it("rejects a revoked superadministrator session", async () => {
    const service = new TenantProvisioningService(
      { resolveForIdentity: async () => null },
      { begin: async () => pending, complete: async () => pending },
      { invite: async () => ({ userId: identity.userId }) },
      "https://app.example.test/auth/callback"
    );

    await expect(
      service.create(identity, "request-1", request)
    ).rejects.toMatchObject({
      status: 401
    });
  });
});
