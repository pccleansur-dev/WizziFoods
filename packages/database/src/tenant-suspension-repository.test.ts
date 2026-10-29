import { describe, expect, it } from "vitest";

import { createTenantSuspensionRepository } from "./tenant-suspension-repository.js";

const unreachableClient = (() => {
  throw new Error("The database must not be queried");
}) as never;

const validRequest = {
  actorUserId: "c1000000-0000-4000-8000-000000000001",
  correlationId: "suspension-commercial-001",
  mode: "commercial" as const,
  reason: "Subscription period ended",
  tenantId: "c3000000-0000-4000-8000-000000000003"
};

describe("tenant suspension repository", () => {
  it("rejects a malformed tenant id before querying", async () => {
    const repository = createTenantSuspensionRepository(unreachableClient);

    await expect(
      repository.request({ ...validRequest, tenantId: "tenant-from-client" })
    ).rejects.toThrow("tenantId must be a UUID");
  });

  it("rejects an unsafe correlation id before querying", async () => {
    const repository = createTenantSuspensionRepository(unreachableClient);

    await expect(
      repository.request({ ...validRequest, correlationId: "bad\nrequest" })
    ).rejects.toThrow("correlationId must be safe");
  });

  it("rejects an invalid reason before querying", async () => {
    const repository = createTenantSuspensionRepository(unreachableClient);

    await expect(
      repository.request({ ...validRequest, reason: " x " })
    ).rejects.toThrow("reason must contain between 3 and 500 characters");
  });

  it("rejects an excessive audit page before querying", async () => {
    const repository = createTenantSuspensionRepository(unreachableClient);

    await expect(
      repository.listAuditEvents(validRequest.actorUserId, 101)
    ).rejects.toThrow("limit must be between 1 and 100");
  });

  it("accepts timestamps returned as text, as drizzle's postgres-js driver does", async () => {
    const rowsClient = (() =>
      Promise.resolve([
        {
          action: "tenant.suspension_requested",
          actor_id: validRequest.actorUserId,
          actor_type: "platform_superadmin",
          correlation_id: "suspension-commercial-001",
          event_id: "9467",
          occurred_at: "2026-10-29 16:59:59.346+00",
          reason: "Subscription period ended",
          tenant_id: validRequest.tenantId,
          tenant_name: "Negocio",
          suspension_mode: "commercial",
          suspension_phase: "suspended",
          suspension_requested_at: "2026-10-29 16:59:59.346+00"
        }
      ])) as never;
    const repository = createTenantSuspensionRepository(rowsClient);

    await expect(
      repository.listAuditEvents(validRequest.actorUserId, 50)
    ).resolves.toMatchObject([{ occurredAt: "2026-10-29T16:59:59.346Z" }]);
    await expect(
      repository.listTenants(validRequest.actorUserId)
    ).resolves.toMatchObject([
      { suspension: { requestedAt: "2026-10-29T16:59:59.346Z" } }
    ]);
  });
});
