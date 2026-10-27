import { describe, expect, it } from "vitest";

import {
  parseBrandIconSize,
  parsePublicBrand,
  parsePublicBrandView,
  toPublicBrandView
} from "./brand.js";

const id = "3c200000-0000-4000-8000-000000000001";
const brand = {
  backgroundColor: "#EEEEEE",
  logo: {
    contentType: "image/png",
    objectPath: `tenants/${id}/locations/${id}/business-profile/logo/${id}.png`,
    version: "abababababababab"
  },
  name: "La Parrilla",
  primaryColor: "#112233"
};

describe("public brand", () => {
  it("reads what the database returns and refuses anything out of shape", () => {
    expect(parsePublicBrand(brand)).toEqual(brand);
    expect(parsePublicBrand({ ...brand, logo: null })?.logo).toBeNull();
    expect(parsePublicBrand({ ...brand, primaryColor: "red" })).toBeNull();
    expect(parsePublicBrand({ ...brand, name: "" })).toBeNull();
    expect(
      parsePublicBrand({
        ...brand,
        logo: { ...brand.logo, objectPath: "../../etc/passwd" }
      })
    ).toBeNull();
  });

  it("shows the public only a version of the logo, never where it is stored", () => {
    const view = toPublicBrandView(brand);
    expect(view).toEqual({
      backgroundColor: "#EEEEEE",
      logoVersion: "abababababababab",
      name: "La Parrilla",
      primaryColor: "#112233"
    });
    expect(JSON.stringify(view)).not.toContain("tenants/");
    expect(parsePublicBrandView(view)).toEqual(view);
    expect(parsePublicBrandView({ ...view, logoVersion: "x" })).toBeNull();
  });

  it("accepts only the icon sizes the app uses", () => {
    expect(parseBrandIconSize("192")).toBe(192);
    expect(parseBrandIconSize("512")).toBe(512);
    expect(parseBrandIconSize("180")).toBe(180);
    expect(parseBrandIconSize("4096")).toBeNull();
    expect(parseBrandIconSize("abc")).toBeNull();
    expect(parseBrandIconSize(undefined)).toBeNull();
  });
});
