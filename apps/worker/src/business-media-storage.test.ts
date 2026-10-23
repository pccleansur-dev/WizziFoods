import { describe, expect, it, vi } from "vitest";

import { createBusinessMediaStorage } from "./business-media-storage.js";

describe("business media storage", () => {
  it("downloads media from the private business bucket", async () => {
    const download = vi.fn().mockResolvedValue({
      data: new Blob([new Uint8Array([1, 2, 3])]),
      error: null
    });
    const from = vi.fn(() => ({ download, upload: vi.fn() }));
    const storage = createBusinessMediaStorage({ from });

    await expect(storage.download("tenant/location/logo/id.webp")).resolves.toEqual(
      new Uint8Array([1, 2, 3])
    );
    expect(from).toHaveBeenCalledWith("business-media");
    expect(download).toHaveBeenCalledWith("tenant/location/logo/id.webp");
  });

  it("replaces media atomically at its canonical object path", async () => {
    const upload = vi.fn().mockResolvedValue({ data: {}, error: null });
    const from = vi.fn(() => ({ download: vi.fn(), upload }));
    const storage = createBusinessMediaStorage({ from });
    const bytes = new Uint8Array([4, 5, 6]);

    await storage.replace(
      "tenant/location/logo/id.webp",
      bytes,
      "image/webp"
    );

    expect(from).toHaveBeenCalledWith("business-media");
    expect(upload).toHaveBeenCalledWith(
      "tenant/location/logo/id.webp",
      bytes,
      {
        cacheControl: "31536000",
        contentType: "image/webp",
        upsert: true
      }
    );
  });

  it("returns stable errors without leaking provider detail", async () => {
    const from = vi.fn(() => ({
      download: vi.fn().mockResolvedValue({
        data: null,
        error: { message: "secret provider response" }
      }),
      upload: vi.fn().mockResolvedValue({
        data: null,
        error: { message: "secret provider response" }
      })
    }));
    const storage = createBusinessMediaStorage({ from });

    await expect(storage.download("safe/path.webp")).rejects.toThrow(
      "Business media download failed"
    );
    await expect(
      storage.replace("safe/path.webp", new Uint8Array([1]), "image/webp")
    ).rejects.toThrow("Business media replacement failed");
  });
});
