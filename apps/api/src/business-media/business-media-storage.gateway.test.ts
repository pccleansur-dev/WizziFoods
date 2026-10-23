import { describe, expect, it } from "vitest";

import { SupabaseBusinessMediaStorageGateway } from "./business-media-storage.gateway.js";

describe("SupabaseBusinessMediaStorageGateway", () => {
  it("creates a non-upserting signed URL in the private bucket", async () => {
    const received: unknown[] = [];
    const gateway = new SupabaseBusinessMediaStorageGateway({
      from(bucket) {
        received.push(["bucket", bucket]);
        return {
          async createSignedUploadUrl(path, options) {
            received.push(["sign", path, options]);
            return {
              data: { signedUrl: "https://storage.test/upload" },
              error: null
            };
          }
        };
      }
    });

    await expect(gateway.createUploadUrl("tenants/a/logo.webp")).resolves.toBe(
      "https://storage.test/upload"
    );
    expect(received).toEqual([
      ["bucket", "business-media"],
      ["sign", "tenants/a/logo.webp", { upsert: false }]
    ]);
  });

  it("does not expose provider errors", async () => {
    const gateway = new SupabaseBusinessMediaStorageGateway({
      from: () => ({
        createSignedUploadUrl: async () => ({
          data: null,
          error: new Error("secret")
        })
      })
    });
    await expect(gateway.createUploadUrl("safe/path.webp")).rejects.toThrow(
      "No se pudo preparar la carga del archivo."
    );
  });
});
