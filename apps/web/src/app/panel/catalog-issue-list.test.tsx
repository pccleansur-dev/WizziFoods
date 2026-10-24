import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CatalogIssueList } from "./catalog-issue-list";

const id = "b2000000-0000-4000-8000-000000000002";

describe("catalog issue list", () => {
  it("renders nothing when the draft can be saved", () => {
    expect(renderToStaticMarkup(<CatalogIssueList issues={[]} />)).toBe("");
  });

  it("lists each problem with its place and a link to the row", () => {
    const markup = renderToStaticMarkup(
      <CatalogIssueList
        issues={[
          {
            entity: "product",
            field: "title",
            id,
            label: "Producto 2 «Nachos»",
            language: "en",
            message: "el nombre en Inglés supera 120 caracteres"
          }
        ]}
      />
    );
    expect(markup).toContain("Para guardar, corregí");
    expect(markup).toContain("Producto 2 «Nachos»");
    expect(markup).toContain("el nombre en Inglés supera 120 caracteres");
    expect(markup).toContain(`href="#catalog-row-${id}"`);
    expect(markup).toContain('role="alert"');
  });
});
