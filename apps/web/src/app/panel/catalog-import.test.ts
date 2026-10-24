import { describe, expect, it } from "vitest";

import { parseCatalogImportsResponse } from "./catalog-import.js";

describe("catalog import responses", () => {
  it("parses review records without accepting a raw source", () => {
    expect(
      parseCatalogImportsResponse({
        data: [
          {
            attemptCount: 1,
            createdAt: "2026-10-23T20:00:00.000Z",
            draft: { errors: [], items: [], overallConfidence: 0 },
            id: "63a64f34-4df0-4c2f-82ea-5ea308fe2cab",
            sourceKind: "pdf",
            status: "review",
            updatedAt: "2026-10-23T20:01:00.000Z"
          }
        ]
      })[0]
    ).toMatchObject({ sourceKind: "pdf", status: "review" });
  });

  it("rejects responses that leak the private import source", () => {
    expect(() =>
      parseCatalogImportsResponse({
        data: [
          {
            attemptCount: 0,
            createdAt: "2026-10-23T20:00:00.000Z",
            draft: null,
            id: "63a64f34-4df0-4c2f-82ea-5ea308fe2cab",
            source: { contentBase64: "secret" },
            sourceKind: "csv",
            status: "queued",
            updatedAt: "2026-10-23T20:00:00.000Z"
          }
        ]
      })
    ).toThrow("inválida");
  });
});
