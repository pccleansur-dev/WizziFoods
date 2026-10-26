import { describe, expect, it } from "vitest";

import { brandIconUrl, manifestFor } from "./brand";

const brand = {
  backgroundColor: "#EEEEEE",
  logoVersion: "abababababababab",
  name: "La Parrilla de Don Anselmo",
  primaryColor: "#112233"
};

describe("brand of the installed app", () => {
  it("builds the manifest from the restaurant's name, colors and logo", () => {
    const manifest = manifestFor(brand);
    expect(manifest).toMatchObject({
      background_color: "#EEEEEE",
      display: "standalone",
      name: "La Parrilla de Don Anselmo",
      short_name: "La Parrilla ",
      theme_color: "#112233"
    });
    expect(manifest.icons?.map((icon) => [icon.sizes, icon.purpose])).toEqual([
      ["192x192", "any"],
      ["512x512", "any"],
      ["512x512", "maskable"]
    ]);
    expect(manifest.icons?.[0]?.src).toBe(
      "/api/brand/icon?size=192&v=abababababababab"
    );
    expect(manifest.icons?.[2]?.src).toBe(
      "/api/brand/icon?size=512&maskable=1&v=abababababababab"
    );
  });

  it("is still a valid manifest when the brand cannot be read", () => {
    const manifest = manifestFor(null);
    expect(manifest.name).toBe("Mozo");
    expect(manifest.icons).toHaveLength(3);
    expect(manifest.icons?.[0]?.src).toBe("/api/brand/icon?size=192");
  });

  it("changes the address of the icon when the logo changes", () => {
    expect(brandIconUrl(180)).toBe("/api/brand/icon?size=180");
    expect(brandIconUrl(180, { version: "aaaaaaaaaaaaaaaa" })).not.toBe(
      brandIconUrl(180, { version: "bbbbbbbbbbbbbbbb" })
    );
  });
});
