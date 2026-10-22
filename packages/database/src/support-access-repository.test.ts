import { describe, expect, it } from "vitest";

import { createSupportAccessRepository } from "./support-access-repository.js";

const unreachableClient = (() => {
  throw new Error("The database must not be queried");
}) as never;

const validGrant = {
  correlationId: "request-support-001",
  durationMinutes: 60,
  grantedBy: "b2000000-0000-4000-8000-000000000002",
  reason: "Diagnóstico solicitado por el Administrador",
  supportUserId: "b1000000-0000-4000-8000-000000000001",
  tenantId: "b4000000-0000-4000-8000-000000000004"
};

describe("support access repository", () => {
  it("rejects an excessive duration before querying", async () => {
    const repository = createSupportAccessRepository(unreachableClient);

    await expect(
      repository.grant({ ...validGrant, durationMinutes: 241 })
    ).rejects.toThrow("durationMinutes must be between 15 and 240");
  });

  it("rejects a malformed support identity before querying", async () => {
    const repository = createSupportAccessRepository(unreachableClient);

    await expect(
      repository.grant({ ...validGrant, supportUserId: "support-from-client" })
    ).rejects.toThrow("supportUserId must be a UUID");
  });

  it("rejects an unsafe correlation identifier before querying", async () => {
    const repository = createSupportAccessRepository(unreachableClient);

    await expect(
      repository.grant({ ...validGrant, correlationId: "bad\nrequest" })
    ).rejects.toThrow("correlationId must be safe");
  });

  it("rejects a malformed revocation before querying", async () => {
    const repository = createSupportAccessRepository(unreachableClient);

    await expect(
      repository.revoke({
        correlationId: "request-support-002",
        grantId: "grant-from-client",
        reason: "Diagnóstico finalizado",
        revokedBy: validGrant.grantedBy,
        tenantId: validGrant.tenantId
      })
    ).rejects.toThrow("grantId must be a UUID");
  });
});
