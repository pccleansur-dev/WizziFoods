import type {
  SupportAccessGrant,
  SupportAccessRepository
} from "@platform/database";
import { describe, expect, it } from "vitest";

import type { TenantAdminRequestContext } from "../tenants/tenant-admin-scope.service.js";
import { SupportAccessService } from "./support-access.service.js";

const context: TenantAdminRequestContext = {
  domain: {
    hostname: "tenant-a.plataforma.test",
    id: "98000000-0000-4000-8000-000000000098"
  },
  identity: {
    assuranceLevel: "aal2",
    userId: "b2000000-0000-4000-8000-000000000002"
  },
  location: {
    id: "92000000-0000-4000-8000-000000000092",
    name: "Principal"
  },
  role: "admin",
  scope: {
    locationId: "92000000-0000-4000-8000-000000000092",
    tenantId: "b4000000-0000-4000-8000-000000000004"
  },
  tenant: {
    id: "b4000000-0000-4000-8000-000000000004",
    name: "Tenant A",
    slug: "tenant-a"
  }
};

const grant: SupportAccessGrant = {
  expiresAt: "2026-10-22T16:00:00.000Z",
  grantedAt: "2026-10-22T15:00:00.000Z",
  id: "b5000000-0000-4000-8000-000000000005",
  reason: "Diagnóstico solicitado",
  revokedAt: null,
  status: "active",
  supportUserId: "b1000000-0000-4000-8000-000000000001"
};

describe("SupportAccessService", () => {
  it("derives grant authority from the guarded tenant context", async () => {
    const received: unknown[] = [];
    const service = new SupportAccessService({
      grant: async (input) => {
        received.push(input);
        return grant;
      }
    } as SupportAccessRepository);

    await expect(
      service.grant(
        context,
        {
          durationMinutes: 60,
          reason: "Diagnóstico solicitado",
          supportUserId: grant.supportUserId
        },
        "request-support-001"
      )
    ).resolves.toEqual(grant);
    expect(received).toEqual([
      {
        correlationId: "request-support-001",
        durationMinutes: 60,
        grantedBy: context.identity.userId,
        reason: "Diagnóstico solicitado",
        supportUserId: grant.supportUserId,
        tenantId: context.scope.tenantId
      }
    ]);
  });

  it("lists and revokes only inside the guarded tenant", async () => {
    const received: unknown[] = [];
    const service = new SupportAccessService({
      list: async (...input) => {
        received.push(["list", ...input]);
        return [grant];
      },
      revoke: async (input) => {
        received.push(["revoke", input]);
        return {
          ...grant,
          revokedAt: "2026-10-22T15:30:00.000Z",
          status: "revoked"
        };
      }
    } as SupportAccessRepository);

    await expect(service.list(context)).resolves.toEqual([grant]);
    await expect(
      service.revoke(
        context,
        grant.id,
        { reason: "Diagnóstico finalizado" },
        "request-support-002"
      )
    ).resolves.toMatchObject({ status: "revoked" });
    expect(received).toEqual([
      ["list", context.scope.tenantId, context.identity.userId],
      [
        "revoke",
        {
          correlationId: "request-support-002",
          grantId: grant.id,
          reason: "Diagnóstico finalizado",
          revokedBy: context.identity.userId,
          tenantId: context.scope.tenantId
        }
      ]
    ]);
  });
});
