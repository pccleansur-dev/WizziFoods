import { describe, expect, it } from "vitest";

import {
  parseCatalogImportApproval,
  parseCatalogImportId,
  parseCatalogImportSubmission
} from "./catalog-import-input.js";

const importId = "63a64f34-4df0-4c2f-82ea-5ea308fe2cab";

describe("catalog import input", () => {
  it("parses a manual submission at the API boundary", () => {
    expect(
      parseCatalogImportSubmission({
        idempotencyKey: "2e55ba2d-938a-44a3-96f7-37a318146e2e",
        source: {
          kind: "manual",
          rows: [
            {
              category: "Cafetería",
              description: "Doble",
              name: "Café",
              price: "1500",
              sector: "Barra"
            }
          ]
        }
      })?.source.kind
    ).toBe("manual");
  });

  it("rejects malformed identifiers", () => {
    expect(() => parseCatalogImportId("another-tenant/import")).toThrow(
      "Identificador"
    );
    expect(parseCatalogImportId(importId)).toBe(importId);
  });

  it("rejects approval while required fields remain doubtful", () => {
    expect(() =>
      parseCatalogImportApproval({
        errors: [],
        items: [
          {
            category: { confidence: 0.2, doubtful: true, value: "" },
            description: { confidence: 1, doubtful: false, value: "" },
            id: "83ec71fc-e2df-45bd-9fb4-68f58842467b",
            issues: ["CATEGORY_MISSING"],
            name: { confidence: 1, doubtful: false, value: "Café" },
            priceCents: { confidence: 1, doubtful: false, value: 150000 },
            rowNumber: 1,
            sector: { confidence: 1, doubtful: false, value: "Barra" }
          }
        ],
        overallConfidence: 0.8
      })
    ).toThrow("campos dudosos");
  });
});
