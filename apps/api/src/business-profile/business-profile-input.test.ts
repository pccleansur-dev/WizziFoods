import { describe, expect, it } from "vitest";

import { parseBusinessProfileRequest } from "./business-profile-input.js";

const validRequest = {
  address: " Av. Siempre Viva 742 ",
  contactPhone: " +54 9 11 5555 1234 ",
  coverAssetId: null,
  description: " Cocina argentina. ",
  displayName: " Bodegón Demo ",
  languages: ["es", "en"],
  logoAssetId: null,
  openingHours: " Martes a domingo ",
  referenceAssetIds: [],
  visual: {
    accentColor: "#d97706",
    headingStyle: "serif",
    layout: "visual",
    primaryColor: "#1f2937",
    secondaryColor: "#f9fafb"
  }
};

describe("business profile input", () => {
  it("normalizes a valid editable draft", () => {
    expect(parseBusinessProfileRequest(validRequest)).toMatchObject({
      address: "Av. Siempre Viva 742",
      description: "Cocina argentina.",
      displayName: "Bodegón Demo",
      visual: {
        accentColor: "#D97706",
        primaryColor: "#1F2937",
        secondaryColor: "#F9FAFB"
      }
    });
  });

  it.each([
    null,
    {},
    { ...validRequest, tenantId: "from-client" },
    { ...validRequest, languages: [] },
    { ...validRequest, displayName: " " },
    { ...validRequest, visual: { ...validRequest.visual, layout: "css" } }
  ])("rejects malformed or over-scoped data", (input) => {
    expect(() => parseBusinessProfileRequest(input)).toThrow(
      "Datos del perfil del negocio inválidos."
    );
  });
});
