import { describe, expect, it } from "vitest";

import { suggestBusinessSlug } from "./business-slug";

describe("suggestBusinessSlug", () => {
  it("drops accents, punctuation and edge hyphens", () => {
    expect(suggestBusinessSlug("Bodegón del Centro")).toBe(
      "bodegon-del-centro"
    );
    expect(suggestBusinessSlug("  ¡Parrilla Don Mateo!  ")).toBe(
      "parrilla-don-mateo"
    );
  });

  it("matches the pattern the form and the API accept", () => {
    const pattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
    for (const name of ["Ñandú & Co.", "Café 24/7", "A".repeat(200)]) {
      const slug = suggestBusinessSlug(name);
      expect(slug.length).toBeLessThanOrEqual(80);
      expect(slug).toMatch(pattern);
    }
  });

  it("returns an empty suggestion when nothing usable is left", () => {
    expect(suggestBusinessSlug("¡¡¡")).toBe("");
  });
});
