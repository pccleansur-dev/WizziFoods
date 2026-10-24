import { describe, expect, it } from "vitest";

import {
  evaluateCatalogImportUpload,
  parseCatalogImportDraft,
  parseCatalogImportRequest,
  parseTenantJobEnvelope
} from "./index.js";

const idempotencyKey = "2e55ba2d-938a-44a3-96f7-37a318146e2e";

describe("catalog import contracts", () => {
  it("accepts a bounded CSV source with an idempotency key", () => {
    const csv = Buffer.from("categoria,nombre,precio\nCafetería,Café,1500");
    expect(
      parseCatalogImportRequest({
        idempotencyKey,
        source: {
          byteLength: csv.byteLength,
          contentBase64: csv.toString("base64"),
          contentType: "text/csv",
          fileName: "carta.csv",
          kind: "csv"
        }
      })
    ).toMatchObject({ idempotencyKey, source: { kind: "csv" } });
  });

  it("accepts manual rows without requiring OCR or a file", () => {
    expect(
      parseCatalogImportRequest({
        idempotencyKey,
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
      })
    ).toMatchObject({ source: { kind: "manual", rows: [{ name: "Café" }] } });
  });

  it("rejects executable content and oversized files", () => {
    expect(
      evaluateCatalogImportUpload({
        byteLength: 100,
        contentType: "application/x-msdownload",
        fileName: "carta.exe",
        kind: "pdf"
      })
    ).toEqual({ accepted: false, reason: "unsupported_type" });
    expect(
      evaluateCatalogImportUpload({
        byteLength: 8 * 1024 * 1024 + 1,
        contentType: "application/pdf",
        fileName: "carta.pdf",
        kind: "pdf"
      })
    ).toEqual({ accepted: false, reason: "too_large" });
  });

  it("requires confidence and explicit doubtful fields in review drafts", () => {
    const draft = parseCatalogImportDraft({
      errors: [],
      items: [
        {
          category: { confidence: 0.94, doubtful: false, value: "Cafetería" },
          description: { confidence: 0.7, doubtful: true, value: "Doble" },
          id: "83ec71fc-e2df-45bd-9fb4-68f58842467b",
          issues: ["DESCRIPTION_LOW_CONFIDENCE"],
          name: { confidence: 0.99, doubtful: false, value: "Café" },
          priceCents: { confidence: 0.96, doubtful: false, value: 150000 },
          rowNumber: 2,
          sector: { confidence: 0.8, doubtful: false, value: "Barra" }
        }
      ],
      overallConfidence: 0.88
    });

    expect(draft?.items[0]?.description.doubtful).toBe(true);
    expect(
      parseCatalogImportDraft({ ...draft, overallConfidence: 1.2 })
    ).toBeNull();
  });

  it("keeps tenant scope inside a canonical import job envelope", () => {
    expect(
      parseTenantJobEnvelope({
        jobId: "6cf6b56b-bb6e-4f89-8ca7-cbe499d33d8b",
        kind: "catalog-import.process",
        payload: { importId: "63a64f34-4df0-4c2f-82ea-5ea308fe2cab" },
        scope: {
          locationId: "d5322dbe-1883-4a09-a29a-5f108ba4999b",
          tenantId: "6b9532a7-fcda-4e0d-8df7-55298f711902"
        }
      })?.kind
    ).toBe("catalog-import.process");
  });
});
