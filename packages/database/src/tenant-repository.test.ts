import { describe, expect, it } from "vitest";

import { createTenantDatabase } from "./tenant-repository.js";

describe("createTenantDatabase", () => {
  it("rejects malformed identity IDs before opening a query", async () => {
    const database = createTenantDatabase(
      "postgresql://unused:unused@127.0.0.1:1/unused"
    );

    await expect(
      database.tenantRepository.findForIdentity("tenant-from-client")
    ).rejects.toThrow("userId must be a UUID");

    await database.close();
  });

  it("rejects malformed session IDs before opening a query", async () => {
    const database = createTenantDatabase(
      "postgresql://unused:unused@127.0.0.1:1/unused"
    );

    await expect(
      database.identityAccessRepository.resolveForIdentity(
        "10000000-0000-4000-8000-000000000001",
        "session-from-client"
      )
    ).rejects.toThrow("sessionId must be a UUID");

    await database.close();
  });
});
