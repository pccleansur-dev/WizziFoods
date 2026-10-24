import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CatalogImportPanel } from "./catalog-import-panel.js";

describe("CatalogImportPanel", () => {
  it("shows confidence, doubtful fields, errors and an approval gate", () => {
    const html = renderToStaticMarkup(
      <CatalogImportPanel
        idempotencyKey="2e55ba2d-938a-44a3-96f7-37a318146e2e"
        imports={[
          {
            attemptCount: 1,
            createdAt: "2026-10-23T20:00:00.000Z",
            draft: {
              errors: [
                {
                  code: "PRICE_INVALID",
                  message: "Revisá el precio.",
                  rowNumber: 1
                }
              ],
              items: [
                {
                  category: {
                    confidence: 0.5,
                    doubtful: true,
                    value: "Cafetería"
                  },
                  description: {
                    confidence: 1,
                    doubtful: false,
                    value: "Doble"
                  },
                  id: "83ec71fc-e2df-45bd-9fb4-68f58842467b",
                  issues: ["PRICE_INVALID"],
                  name: { confidence: 1, doubtful: false, value: "Café" },
                  priceCents: { confidence: 0, doubtful: true, value: null },
                  rowNumber: 1,
                  sector: { confidence: 1, doubtful: false, value: "Barra" }
                }
              ],
              overallConfidence: 0.7
            },
            id: "63a64f34-4df0-4c2f-82ea-5ea308fe2cab",
            sourceKind: "csv",
            status: "review",
            updatedAt: "2026-10-23T20:01:00.000Z"
          }
        ]}
      />
    );

    expect(html).toContain("Confianza general: 70%");
    expect(html).toContain("Campo dudoso");
    expect(html).toContain("Revisá el precio.");
    expect(html).toContain("Aprobar e incorporar al borrador");
    expect(html).toContain("Descartar importación");
  });
});
