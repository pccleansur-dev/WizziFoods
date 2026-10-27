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

  it("asks to approve automatic translations and says publishing waits for it", () => {
    const pending = {
      ...draft,
      categories: [
        {
          content: [
            { description: "", language: "es", title: "Platos" },
            {
              description: "",
              language: "en",
              review: "machine" as const,
              title: "Dishes"
            }
          ],
          id: "c1000000-0000-4000-8000-000000000001",
          position: 0
        }
      ]
    };
    const markup = renderToStaticMarkup(
      <CatalogTranslateButton
        change={() => undefined}
        draft={pending}
        languages={["es", "en"]}
        onTranslate={noop}
      />
    );
    expect(markup).toContain("1 texto con traducción automática sin revisar");
    expect(markup).toContain("No se puede publicar hasta que los apruebes");
    expect(markup).toContain("Aprobar las traducciones revisadas");
    expect(
      renderToStaticMarkup(
        <CatalogTranslateButton
          change={() => undefined}
          draft={draft}
          languages={["es", "en"]}
          onTranslate={noop}
        />
      )
    ).not.toContain("Aprobar");
  });
});
