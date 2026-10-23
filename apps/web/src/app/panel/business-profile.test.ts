import { describe, expect, it } from "vitest";

import { parseBusinessProfileResponse } from "./business-profile";

const draft = {
  address: "Av. Siempre Viva 742",
  contactPhone: "+54 9 11 5555 1234",
  coverAssetId: null,
  description: "Cocina argentina.",
  displayName: "Bodegón Demo",
  languages: ["es", "en"],
  logoAssetId: null,
  openingHours: "Martes a domingo",
  referenceAssetIds: [],
  revision: 2,
  updatedAt: "2026-10-23T00:30:00.000Z",
  visual: {
    accentColor: "#D97706",
    headingStyle: "serif",
    layout: "visual",
    primaryColor: "#1F2937",
    secondaryColor: "#F9FAFB"
  }
};

describe("business profile response", () => {
  it("accepts a canonical saved draft", () => {
    expect(parseBusinessProfileResponse({ data: draft })).toEqual(draft);
  });

  it("accepts an empty first-time profile", () => {
    expect(parseBusinessProfileResponse({ data: null })).toBeNull();
  });

  it.each([
    {},
    { data: { ...draft, revision: 0 } },
    { data: { ...draft, tenantId: "from-server" } },
    { data: { ...draft, updatedAt: "not-a-date" } }
  ])("rejects malformed server data", (input) => {
    expect(() => parseBusinessProfileResponse(input)).toThrow(
      "Respuesta de perfil inválida."
    );
  });
});
