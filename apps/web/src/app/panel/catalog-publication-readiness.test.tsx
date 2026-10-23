import type { CatalogDraft } from "@platform/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  CatalogPublicationReadiness,
  catalogIsReadyToPublish
} from "./catalog-publication-readiness";

const completeDraft: CatalogDraft = {
  baseRevision: null,
  categories: [
    {
      content: [
        { description: "", language: "es", title: "Principales" },
        { description: "", language: "en", title: "Main dishes" }
      ],
      id: "10000000-0000-4000-8000-000000000001",
      position: 0
    }
  ],
  products: [
    {
      categoryId: "10000000-0000-4000-8000-000000000001",
      content: [
        { description: "", language: "es", title: "Milanesa" },
        { description: "", language: "en", title: "Milanese" }
      ],
      id: "30000000-0000-4000-8000-000000000003",
      imageAssetId: null,
      position: 0,
      priceCents: 125000,
      sectorId: "20000000-0000-4000-8000-000000000002",
      variants: []
    }
  ],
  sectors: [
    {
      id: "20000000-0000-4000-8000-000000000002",
      kind: "kitchen",
      name: "Cocina",
      position: 0
    }
  ]
};

describe("catalog publication readiness", () => {
  it("keeps every missing requirement visible before publication", () => {
    const markup = renderToStaticMarkup(
      <CatalogPublicationReadiness
        draft={{
          baseRevision: null,
          categories: [],
          products: [],
          sectors: []
        }}
        hasBusinessProfile={false}
        languages={["es", "en"]}
      />
    );

    expect(markup).toContain("Identidad básica guardada");
    expect(markup).toContain("Al menos una categoría");
    expect(markup).toContain("Al menos un sector");
    expect(markup).toContain("Al menos un producto");
    expect(markup).toContain('aria-label="Pendiente"');
    expect(catalogIsReadyToPublish(completeDraft, ["es", "en"], false)).toBe(
      false
    );
  });

  it("reports a complete multilingual catalog as ready", () => {
    const markup = renderToStaticMarkup(
      <CatalogPublicationReadiness
        draft={completeDraft}
        hasBusinessProfile
        languages={["es", "en"]}
      />
    );

    expect(markup).toContain("Lista para publicar");
    expect(markup).toContain('aria-label="Completo"');
    expect(catalogIsReadyToPublish(completeDraft, ["es", "en"], true)).toBe(
      true
    );
  });
});
