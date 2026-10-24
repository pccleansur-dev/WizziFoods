import { describe, expect, it } from "vitest";

import { createCatalogImportRepository } from "./catalog-import-repository.js";

const scope = {
  locationId: "d5322dbe-1883-4a09-a29a-5f108ba4999b",
  tenantId: "6b9532a7-fcda-4e0d-8df7-55298f711902"
};
const requesterId = "e1000000-0000-4000-8000-000000000001";
const importId = "63a64f34-4df0-4c2f-82ea-5ea308fe2cab";

describe("catalog import repository", () => {
  it("returns an idempotent queued import without exposing its source", async () => {
    const client = (() =>
      Promise.resolve([
        {
          attempt_count: 0,
          created_at: "2026-10-23T20:00:00Z",
          draft: null,
          id: importId,
          source_kind: "csv",
          status: "queued",
          updated_at: "2026-10-23T20:00:00Z"
        }
      ])) as never;
    const repository = createCatalogImportRepository(client);

    await expect(
      repository.enqueue({
        request: {
          idempotencyKey: "2e55ba2d-938a-44a3-96f7-37a318146e2e",
          source: {
            byteLength: 3,
            contentBase64: "YSxi",
            contentType: "text/csv",
            fileName: "carta.csv",
            kind: "csv"
          }
        },
        requesterId,
        scope
      })
    ).resolves.toEqual({
      attemptCount: 0,
      createdAt: "2026-10-23T20:00:00.000Z",
      draft: null,
      id: importId,
      sourceKind: "csv",
      status: "queued",
      updatedAt: "2026-10-23T20:00:00.000Z"
    });
  });

  it("rejects a mismatched worker scope before querying", async () => {
    const repository = createCatalogImportRepository((() => {
      throw new Error("database must not be queried");
    }) as never);

    await expect(
      repository.claim({
        importId,
        scope: { ...scope, tenantId: "another-tenant" }
      })
    ).rejects.toThrow("catalog import scope must be canonical");
  });

  it("validates worker delivery controls before querying", async () => {
    const repository = createCatalogImportRepository((() => {
      throw new Error("database must not be queried");
    }) as never);

    await expect(repository.readJob(0)).rejects.toThrow(
      "visibility timeout must be between 1 and 3600 seconds"
    );
    await expect(repository.ackJob("not-a-message")).rejects.toThrow(
      "messageId must be a positive integer"
    );
  });
});
