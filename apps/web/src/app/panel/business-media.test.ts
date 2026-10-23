import { describe, expect, it } from "vitest";

import {
  parseBusinessMediaReservation,
  parseBusinessMediaStatus
} from "./business-media";

const assetId = "e6000000-0000-4000-8000-000000000006";

describe("business media API responses", () => {
  it("accepts a canonical reservation", () => {
    expect(
      parseBusinessMediaReservation({
        data: {
          contentType: "image/webp",
          expiresAt: "2026-10-23T12:00:00.000Z",
          id: assetId,
          kind: "logo",
          objectPath: "tenants/t/locations/l/business-profile/logo/id.webp",
          sourceSizeBytes: 1024,
          status: "reserved",
          uploadUrl: "http://storage.local/upload?token=signed"
        }
      })
    ).toMatchObject({ id: assetId, status: "reserved" });
  });

  it("accepts only canonical processing status", () => {
    expect(
      parseBusinessMediaStatus({
        data: { assetId, kind: "cover", status: "ready" }
      })
    ).toEqual({ assetId, kind: "cover", status: "ready" });
    expect(() =>
      parseBusinessMediaStatus({
        data: {
          assetId,
          kind: "cover",
          status: "ready",
          tenantId: "from-server"
        }
      })
    ).toThrow("Respuesta de archivo inválida.");
  });
});
