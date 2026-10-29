import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DinerProductImage } from "./diner-product-image";

const asset = "3e100000-0000-4000-8000-0000000000a1";

describe("DinerProductImage", () => {
  it("shows the initial when the product has no photo", () => {
    const html = renderToStaticMarkup(
      <DinerProductImage size="card" title="milanesa" />
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("<span>M</span>");
  });

  it("shows the photo served by the host, in card and in detail", () => {
    for (const size of ["card", "hero"] as const) {
      const html = renderToStaticMarkup(
        <DinerProductImage imageAssetId={asset} size={size} title="Milanesa" />
      );
      expect(html).toContain(`src="/api/catalog/image/${asset}"`);
      expect(html).toContain(`diner-image--${size}`);
      expect(html).toContain('aria-hidden="true"');
    }
  });
});
