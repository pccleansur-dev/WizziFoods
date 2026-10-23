import { describe, expect, it } from "vitest";

import { createBusinessMediaRepository } from "./business-media-repository.js";

const unreachableClient = (() => {
  throw new Error("The database must not be queried");
}) as never;

const validInput = {
  byteLength: 2048,
  contentType: "image/jpeg",
  kind: "logo" as const,
  requesterId: "e1000000-0000-4000-8000-000000000001",
  scope: {
    locationId: "e5000000-0000-4000-8000-000000000005",
    tenantId: "e3000000-0000-4000-8000-000000000003"
  }
};

describe("business media repository", () => {
  it("rejects a non-canonical scope before querying", async () => {
    const repository = createBusinessMediaRepository(unreachableClient);
    await expect(
      repository.reserve({
        ...validInput,
        scope: { ...validInput.scope, tenantId: "from-client" }
      })
    ).rejects.toThrow("tenant scope must be canonical");
  });

  it("rejects an unsupported type before querying", async () => {
    const repository = createBusinessMediaRepository(unreachableClient);
    await expect(
      repository.reserve({ ...validInput, contentType: "image/svg+xml" })
    ).rejects.toThrow("business media upload must be canonical");
  });

  it("rejects an excessive source before querying", async () => {
    const repository = createBusinessMediaRepository(unreachableClient);
    await expect(
      repository.reserve({ ...validInput, byteLength: 13 * 1024 * 1024 })
    ).rejects.toThrow("business media upload must be canonical");
  });
});
