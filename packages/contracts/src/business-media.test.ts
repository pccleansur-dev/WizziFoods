import { describe, expect, it } from "vitest";

import {
  BUSINESS_MEDIA_POLICY,
  businessMediaObjectPath,
  evaluateBusinessMediaUpload
} from "./business-media.js";

const scope = {
  locationId: "92000000-0000-4000-8000-000000000092",
  tenantId: "91000000-0000-4000-8000-000000000091"
};

describe("business media policy", () => {
  it("accepts supported source images while the tenant remains within quota", () => {
    expect(
      evaluateBusinessMediaUpload({
        byteLength: 2 * 1024 * 1024,
        contentType: "image/jpeg",
        currentTenantBytes: 4 * 1024 * 1024
      })
    ).toEqual({ accepted: true });
  });

  it.each([
    {
      expected: "unsupported_type",
      input: {
        byteLength: 1024,
        contentType: "image/svg+xml",
        currentTenantBytes: 0
      }
    },
    {
      expected: "invalid_size",
      input: {
        byteLength: 0,
        contentType: "image/png",
        currentTenantBytes: 0
      }
    },
    {
      expected: "file_too_large",
      input: {
        byteLength: BUSINESS_MEDIA_POLICY.maxSourceBytes + 1,
        contentType: "image/webp",
        currentTenantBytes: 0
      }
    },
    {
      expected: "tenant_quota_exceeded",
      input: {
        byteLength: 1,
        contentType: "image/jpeg",
        currentTenantBytes: BUSINESS_MEDIA_POLICY.maxTenantBytes
      }
    }
  ])("rejects unsafe or excessive input: $expected", ({ expected, input }) => {
    expect(evaluateBusinessMediaUpload(input)).toEqual({
      accepted: false,
      reason: expected
    });
  });

  it("derives an opaque tenant-scoped path instead of trusting a filename", () => {
    expect(
      businessMediaObjectPath({
        assetId: "93000000-0000-4000-8000-000000000093",
        extension: "webp",
        kind: "logo",
        scope
      })
    ).toBe(
      `tenants/${scope.tenantId}/locations/${scope.locationId}/business-profile/logo/93000000-0000-4000-8000-000000000093.webp`
    );
    expect(() =>
      businessMediaObjectPath({
        assetId: "../../other-tenant",
        extension: "webp",
        kind: "logo",
        scope
      })
    ).toThrow("assetId must be a UUID");
    expect(() =>
      businessMediaObjectPath({
        assetId: "93000000-0000-4000-8000-000000000093",
        extension: "../png" as "png",
        kind: "cover",
        scope
      })
    ).toThrow("extension must be supported");
  });

  it("supports a tenant-scoped product image without accepting a filename", () => {
    expect(
      businessMediaObjectPath({
        assetId: "93000000-0000-4000-8000-000000000093",
        extension: "jpg",
        kind: "product",
        scope
      })
    ).toBe(
      `tenants/${scope.tenantId}/locations/${scope.locationId}/business-profile/product/93000000-0000-4000-8000-000000000093.jpg`
    );
  });
});
