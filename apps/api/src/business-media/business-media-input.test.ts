import { describe, expect, it } from "vitest";

import { parseBusinessMediaReservationRequest } from "./business-media-input.js";

describe("business media reservation input", () => {
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
