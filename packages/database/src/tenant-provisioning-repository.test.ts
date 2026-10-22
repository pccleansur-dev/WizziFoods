import { describe, expect, it } from "vitest";

import { createTenantProvisioningRepository } from "./tenant-provisioning-repository.js";

const unreachableClient = (() => {
  throw new Error("The database must not be queried");
}) as never;

describe("tenant provisioning repository", () => {
  it("rejects malformed activation identities before querying", async () => {
    const repository = createTenantProvisioningRepository(unreachableClient);

    await expect(
      repository.activateForIdentity("identity-from-client")
    ).rejects.toThrow("userId must be a UUID");
  });

  it("rejects a malformed actor before querying the database", async () => {
    const repository = createTenantProvisioningRepository(unreachableClient);

    await expect(
      repository.begin({
        actorUserId: "platform-admin-from-client",
        idempotencyKey: "request-1",
        platformHostname: "new-business.plataforma.test",
        request: {
          adminEmail: "owner@example.com",
          name: "New Business",
          slug: "new-business"
        }
      })
    ).rejects.toThrow("actorUserId must be a UUID");
  });

  it("rejects an empty idempotency key before querying the database", async () => {
    const repository = createTenantProvisioningRepository(unreachableClient);

    await expect(
      repository.begin({
        actorUserId: "70000000-0000-4000-8000-000000000007",
        idempotencyKey: "",
        platformHostname: "new-business.plataforma.test",
        request: {
          adminEmail: "owner@example.com",
          name: "New Business",
          slug: "new-business"
        }
      })
    ).rejects.toThrow(
      "idempotencyKey must contain between 1 and 255 characters"
    );
  });

  it("rejects a non-canonical platform hostname before querying", async () => {
    const repository = createTenantProvisioningRepository(unreachableClient);

    await expect(
      repository.begin({
        actorUserId: "70000000-0000-4000-8000-000000000007",
        idempotencyKey: "request-1",
        platformHostname: "https://New-Business.Plataforma.Test",
        request: {
          adminEmail: "owner@example.com",
          name: "New Business",
          slug: "new-business"
        }
      })
    ).rejects.toThrow("platformHostname must be canonical");
  });

  it("rejects malformed completion identifiers before querying", async () => {
    const repository = createTenantProvisioningRepository(unreachableClient);

    await expect(
      repository.complete({
        actorUserId: "70000000-0000-4000-8000-000000000007",
        authUserId: "72000000-0000-4000-8000-000000000072",
        requestId: "request-from-client"
      })
    ).rejects.toThrow("requestId must be a UUID");
  });
});
