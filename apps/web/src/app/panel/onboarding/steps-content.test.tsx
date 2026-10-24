import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BusinessStep } from "./business-step";
import { CartaStep } from "./carta-step";

const businessProfile = {
  address: "San Martín 120",
  contactPhone: "+54 11 5555 5555",
  coverAssetId: null,
  description: "Cocina porteña",
  displayName: "Bodegón del Centro",
  languages: ["es", "en"],
  logoAssetId: null,
  openingHours: "Todos los días",
  referenceAssetIds: [],
  revision: 1,
  updatedAt: "2026-10-23T15:00:00.000Z",
  visual: {
    accentColor: "#D97706",
    headingStyle: "serif",
    layout: "visual",
    primaryColor: "#1F2937",
    secondaryColor: "#F9FAFB"
  }
};

const catalog = {
  basePublishedRevision: null,
  draft: {
    baseRevision: null,
    categories: [
      {
        content: [{ description: "", language: "es", title: "Principales" }],
        id: "20000000-0000-4000-8000-000000000002",
        position: 0
      }
    ],
    products: [
      {
        categoryId: "20000000-0000-4000-8000-000000000002",
        content: [
          {
            description: "Con papas",
            language: "es",
            title: "Milanesa"
          }
        ],
        id: "30000000-0000-4000-8000-000000000003",
        imageAssetId: null,
        position: 0,
        priceCents: 125000,
        sectorId: "40000000-0000-4000-8000-000000000004",
        variants: []
      }
    ],
    sectors: [
      {
        id: "40000000-0000-4000-8000-000000000004",
        kind: "kitchen",
        name: "Cocina",
        position: 0
      }
    ]
  },
  isDirty: true,
  revision: 1,
  updatedAt: "2026-10-23T15:00:00.000Z"
};

const publishedCatalog = {
  availability: {},
  catalog: {
    baseRevision: 1,
    categories: [
      {
        content: [{ description: "", language: "es", title: "Principales" }],
        id: "20000000-0000-4000-8000-000000000002",
        position: 0
      }
    ],
    products: [
      {
        categoryId: "20000000-0000-4000-8000-000000000002",
        content: [
          {
            description: "Con papas",
            language: "es",
            title: "Milanesa"
          }
        ],
        id: "30000000-0000-4000-8000-000000000003",
        imageAssetId: null,
        position: 0,
        priceCents: 125000,
        sectorId: "40000000-0000-4000-8000-000000000004",
        variants: []
      }
    ],
    sectors: [
      {
        id: "40000000-0000-4000-8000-000000000004",
        kind: "kitchen",
        name: "Cocina",
        position: 0
      }
    ]
  },
  publishedAt: "2026-10-23T16:00:00.000Z",
  revision: 1
};

describe("onboarding step screens", () => {
  it("shows the business identity form on its own screen", () => {
    const markup = renderToStaticMarkup(
      <BusinessStep
        businessProfile={businessProfile as never}
        tenantName="Bodegón del Centro"
      />
    );
    expect(markup).toContain("Bodegón del Centro");
    expect(markup).toContain("Datos e identidad");
    expect(markup).toContain("Logo del negocio");
    expect(markup).toContain("Imagen de portada");
    expect(markup).toContain("Fotos de referencia");
    expect(markup).toContain("Vista previa");
    expect(markup).toContain("no modifica lo publicado");
    expect(markup).not.toContain("Carta y productos");
  });

  it("shows the catalog import and editor on their own screen", () => {
    const markup = renderToStaticMarkup(
      <CartaStep
        businessProfile={businessProfile as never}
        catalog={catalog as never}
        catalogImports={[]}
        idempotencyKey="f0000000-0000-4000-8000-000000000001"
        publishedCatalog={publishedCatalog as never}
        tenantName="Bodegón del Centro"
      />
    );
    expect(markup).toContain("Carta y productos");
    expect(markup).toContain("Vista previa de la carta");
    expect(markup).toContain("Agregar categoría");
    expect(markup).toContain("Contenido por idioma");
    expect(markup).toContain("Agregar variante");
    expect(markup).toContain("Disponibilidad inmediata");
    expect(markup).toContain("Milanesa");
    expect(markup).toContain("Disponible");
    expect(markup).not.toContain("Logo del negocio");
  });
});
