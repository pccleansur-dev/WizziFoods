import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CatalogAvailabilityControl } from "./catalog-availability";

describe("CatalogAvailabilityControl", () => {
  it("renders the current published status and its inverse action", () => {
    const markup = renderToStaticMarkup(
      <CatalogAvailabilityControl
        initialAvailability={{ isAvailable: false, version: 2 }}
        productId="30000000-0000-4000-8000-000000000003"
        productTitle="Milanesa"
      />
    );

    expect(markup).toContain("Milanesa");
    expect(markup).toContain("No disponible");
    expect(markup).toContain("Marcar disponible");
    expect(markup).toContain('name="expectedVersion" value="2"');
    expect(markup).toContain('aria-pressed="false"');
  });
});
