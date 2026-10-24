import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BusinessMediaUploadField } from "./business-media-upload-field";
import { CatalogPreview } from "./catalog-preview";

const categoryId = "a1000000-0000-4000-8000-000000000001";
const sectorId = "a3000000-0000-4000-8000-000000000003";
const assetId = "a5000000-0000-4000-8000-000000000005";
const draft = {
  baseRevision: null,
  categories: [
    {
      content: [{ description: "", language: "es", title: "Platos" }],
      id: categoryId,
      position: 0
    }
  ],
  products: [
    {
      categoryId,
      content: [{ description: "", language: "es", title: "Milanesa" }],
      id: "a2000000-0000-4000-8000-000000000002",
      imageAssetId: assetId,
      position: 0,
      priceCents: 1000,
      sectorId,
      variants: []
    }
  ],
  sectors: [
    { id: sectorId, kind: "kitchen" as const, name: "Cocina", position: 0 }
  ]
};

describe("catalog thumbnails", () => {
  it("shows the uploaded photo next to its product in the preview", () => {
    const markup = renderToStaticMarkup(
      <CatalogPreview
        draft={draft}
        language="es"
        previews={{ [assetId]: "blob:http://demo.localhost/abc" }}
        publishedRevision={null}
      />
    );
    expect(markup).toContain('src="blob:http://demo.localhost/abc"');
    expect(markup).toContain('alt=""');
  });

  it("keeps the preview text-only when the photo has no local thumbnail", () => {
    const markup = renderToStaticMarkup(
      <CatalogPreview
        draft={draft}
        language="es"
        previews={{}}
        publishedRevision={null}
      />
    );
    expect(markup).not.toContain("<img");
    expect(markup).toContain("Milanesa");
  });

  it("shows the thumbnail inside the upload field", () => {
    const markup = renderToStaticMarkup(
      <BusinessMediaUploadField
        hasAsset
        help="ayuda"
        kind="product"
        label="Foto del producto"
        onReady={() => undefined}
        previewUrl="blob:http://demo.localhost/abc"
      />
    );
    expect(markup).toContain('src="blob:http://demo.localhost/abc"');
    expect(markup).toContain("media-upload-field__thumb");
  });

  it("only renders blob previews so a remote URL can never be injected", () => {
    const markup = renderToStaticMarkup(
      <BusinessMediaUploadField
        help="ayuda"
        kind="product"
        label="Foto"
        onReady={() => undefined}
        previewUrl="https://evil.example/x.png"
      />
    );
    expect(markup).not.toContain("<img");
  });
});
