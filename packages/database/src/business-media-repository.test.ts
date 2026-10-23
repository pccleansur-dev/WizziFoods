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
  it("rejects malformed worker claims before querying", async () => {
    const repository = createBusinessMediaRepository(unreachableClient);
    await expect(
      repository.claim({
        assetId: "asset-from-queue",
        scope: validInput.scope
      })
    ).rejects.toThrow("assetId must be a UUID");
  });

  it("rejects malformed status identifiers before querying", async () => {
    const repository = createBusinessMediaRepository(unreachableClient);
    await expect(
      repository.getStatus({
        assetId: "asset-from-client",
        requesterId: validInput.requesterId,
        scope: validInput.scope
      })
    ).rejects.toThrow("assetId must be a UUID");
  });

  it("rejects unsafe queue controls before querying", async () => {
    const repository = createBusinessMediaRepository(unreachableClient);
    await expect(repository.readJob(0)).rejects.toThrow(
      "visibility timeout must be between 1 and 3600 seconds"
    );
    await expect(repository.ackJob("0")).rejects.toThrow(
      "messageId must be a positive integer"
    );
  });

  it("rejects malformed queue identifiers before querying", async () => {
    const repository = createBusinessMediaRepository(unreachableClient);
    await expect(
      repository.queue({
        assetId: "asset-from-client",
        requesterId: validInput.requesterId,
        scope: validInput.scope
      })
    ).rejects.toThrow("assetId must be a UUID");
  });

  it("rejects malformed completion identifiers before querying", async () => {
    const repository = createBusinessMediaRepository(unreachableClient);
    await expect(
      repository.complete({
        assetId: "asset-from-client",
        height: 480,
        scope: validInput.scope,
        sha256: "a".repeat(64),
        storedSizeBytes: 1536,
        width: 640
      })
    ).rejects.toThrow("assetId must be a UUID");
  });

  it("rejects untrusted processed metadata before querying", async () => {
    const repository = createBusinessMediaRepository(unreachableClient);
    await expect(
      repository.complete({
        assetId: "e6000000-0000-4000-8000-000000000006",
        height: 480,
        scope: validInput.scope,
        sha256: "not-a-digest",
        storedSizeBytes: 1536,
        width: 640
      })
    ).rejects.toThrow("processed business media metadata must be canonical");
  });

  it("rejects malformed failure identifiers before querying", async () => {
    const repository = createBusinessMediaRepository(unreachableClient);
    await expect(
      repository.fail({
        assetId: "asset-from-client",
        scope: validInput.scope
      })
    ).rejects.toThrow("assetId must be a UUID");
  });

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
