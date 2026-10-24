import { describe, expect, it } from "vitest";

import {
  normalizeCatalogImportRows,
  parseCatalogCsv,
  verifyCatalogImportFile
} from "./catalog-import-processor.js";

describe("catalog import normalization", () => {
  it("normalizes a quoted CSV into a review draft with confidence", () => {
    const rows = parseCatalogCsv(
      new TextEncoder().encode(
        'categoria,nombre,descripcion,precio,sector\nCafetería,"Café, doble",Intenso,"1.500,50",Barra'
      )
    );
    const draft = normalizeCatalogImportRows(
      rows,
      "csv",
      () => "83ec71fc-e2df-45bd-9fb4-68f58842467b"
    );

    expect(draft.items[0]).toMatchObject({
      name: { doubtful: false, value: "Café, doble" },
      priceCents: { value: 150050 }
    });
    expect(draft.overallConfidence).toBeGreaterThan(0.8);
  });

  it("marks incomplete and suspicious cells instead of trusting them", () => {
    const draft = normalizeCatalogImportRows(
      [
        {
          category: "",
          description: "",
          name: '=HYPERLINK("https://invalid")',
          price: "precio a confirmar",
          sector: ""
        }
      ],
      "xlsx",
      () => "83ec71fc-e2df-45bd-9fb4-68f58842467b"
    );

    expect(draft.items[0]?.issues).toEqual(
      expect.arrayContaining([
        "CATEGORY_MISSING",
        "PRICE_INVALID",
        "SECTOR_MISSING",
        "UNSAFE_CELL_VALUE"
      ])
    );
    expect(draft.items[0]?.name.doubtful).toBe(true);
  });

  it("rejects mismatched file signatures before parsing", () => {
    expect(() =>
      verifyCatalogImportFile(
        new TextEncoder().encode("<script>alert(1)</script>"),
        "application/pdf",
        "pdf"
      )
    ).toThrow("signature");
  });
});
