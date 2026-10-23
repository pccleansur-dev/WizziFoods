import { describe, expect, it } from "vitest";

import {
  parseBusinessMediaAssetId,
  parseBusinessMediaReservationRequest
} from "./business-media-input.js";

describe("business media reservation input", () => {
  it("accepts only canonical asset identifiers", () => {
    expect(
      parseBusinessMediaAssetId("e6000000-0000-4000-8000-000000000006")
    ).toBe("e6000000-0000-4000-8000-000000000006");
    expect(() => parseBusinessMediaAssetId("asset-from-client")).toThrow(
      "Identificador de archivo inválido."
    );
  });

  it("accepts a supported image source", () => {
    expect(
      parseBusinessMediaReservationRequest({
        byteLength: 2048,
        contentType: "image/jpeg",
        kind: "logo"
      })
    ).toEqual({
      byteLength: 2048,
      contentType: "image/jpeg",
      kind: "logo"
    });
  });

  it("accepts product images under the same upload policy", () => {
    expect(
      parseBusinessMediaReservationRequest({
        byteLength: 4096,
        contentType: "image/webp",
        kind: "product"
      })
    ).toEqual({
      byteLength: 4096,
      contentType: "image/webp",
      kind: "product"
    });
  });

  it.each([
    null,
    {},
    { byteLength: 2048, contentType: "image/svg+xml", kind: "logo" },
    { byteLength: 13 * 1024 * 1024, contentType: "image/png", kind: "cover" },
    { byteLength: 2048, contentType: "image/jpeg", kind: "avatar" },
    {
      byteLength: 2048,
      contentType: "image/jpeg",
      kind: "logo",
      tenantId: "from-client"
    }
  ])("rejects unsafe or over-scoped data", (input) => {
    expect(() => parseBusinessMediaReservationRequest(input)).toThrow(
      "Datos del archivo inválidos."
    );
  });
});
