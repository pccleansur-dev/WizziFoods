import { describe, expect, it, vi } from "vitest";

import { uploadBusinessMedia } from "./business-media-upload";

const assetId = "e6000000-0000-4000-8000-000000000006";

describe("business media upload", () => {
  it("uploads, polls and returns a ready asset", async () => {
    const file = new File([new Uint8Array([1, 2])], "logo.webp", {
      type: "image/webp"
    });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json(
          { data: { assetId, kind: "logo", status: "processing" } },
          { status: 202 }
        )
      )
      .mockResolvedValueOnce(
        Response.json({ data: { assetId, kind: "logo", status: "ready" } })
      );
    const onStatus = vi.fn();

    await expect(
      uploadBusinessMedia(file, "logo", {
        fetcher,
        onStatus,
        wait: vi.fn().mockResolvedValue(undefined)
      })
    ).resolves.toBe(assetId);
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      `/api/business-media/${assetId}`,
      expect.objectContaining({ method: "GET" })
    );
    expect(onStatus).toHaveBeenCalledWith("processing");
  });

  it("rejects unsupported files before making a request", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const file = new File(["<svg></svg>"], "logo.svg", {
      type: "image/svg+xml"
    });

    await expect(
      uploadBusinessMedia(file, "logo", { fetcher })
    ).rejects.toThrow("Usá una imagen JPG, PNG o WebP de hasta 12 MB.");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("surfaces a rejected processed image", async () => {
    const file = new File([new Uint8Array([1, 2])], "logo.webp", {
      type: "image/webp"
    });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json(
          { data: { assetId, kind: "logo", status: "processing" } },
          { status: 202 }
        )
      )
      .mockResolvedValueOnce(
        Response.json({ data: { assetId, kind: "logo", status: "failed" } })
      );

    await expect(
      uploadBusinessMedia(file, "logo", {
        fetcher,
        wait: vi.fn().mockResolvedValue(undefined)
      })
    ).rejects.toThrow("La imagen no pudo validarse.");
  });
});
