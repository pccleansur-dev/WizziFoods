import { describe, expect, it } from "vitest";

import { createAuditRepository } from "./audit-repository.js";

const unreachableClient = (() => {
  throw new Error("The database must not be queried");
}) as never;

const validEvent = {
  action: "tenant.suspension_requested",
  actorId: "a9100000-0000-4000-8000-000000000019",
  actorType: "platform_superadmin" as const,
  correlationId: "request-audit-001",
  reason: "Incumplimiento comercial confirmado",
  tenantId: "a9000000-0000-4000-8000-000000000009"
};

describe("audit repository", () => {
  it("rejects a malformed tenant before querying", async () => {
    const repository = createAuditRepository(unreachableClient);

    await expect(
      repository.append({ ...validEvent, tenantId: "tenant-from-client" })
    ).rejects.toThrow("tenantId must be a UUID");
  });

  it("rejects an unsafe correlation identifier before querying", async () => {
    const repository = createAuditRepository(unreachableClient);

    await expect(
      repository.append({
        ...validEvent,
        correlationId: "request\nwith-control-character"
      })
    ).rejects.toThrow("correlationId must be safe");
  });

  it("requires a useful reason before querying", async () => {
    const repository = createAuditRepository(unreachableClient);

    await expect(
      repository.append({ ...validEvent, reason: "no" })
    ).rejects.toThrow("reason must contain between 3 and 500 characters");
  });

  it("rejects a partial subject reference before querying", async () => {
    const repository = createAuditRepository(unreachableClient);

    await expect(
      repository.append({ ...validEvent, subjectType: "tenant" })
    ).rejects.toThrow("subjectType and subjectId must be provided together");
  });
});
