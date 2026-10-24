import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CatalogTranslateButton } from "./catalog-translate-button";

const draft = { baseRevision: null, categories: [], products: [], sectors: [] };
const noop = () => Promise.reject(new Error("not used"));

describe("catalog translate button", () => {
  it("is hidden when the business has a single language", () => {
    expect(
      renderToStaticMarkup(
        <CatalogTranslateButton
          change={() => undefined}
          draft={draft}
          languages={["es"]}
          onTranslate={noop}
        />
      )
    ).toBe("");
  });

  it("offers to translate what is missing when there are several languages", () => {
    const markup = renderToStaticMarkup(
      <CatalogTranslateButton
        change={() => undefined}
        draft={draft}
        languages={["es", "en"]}
        onTranslate={noop}
      />
    );
    expect(markup).toContain("Traducir lo que falta");
  });
});
