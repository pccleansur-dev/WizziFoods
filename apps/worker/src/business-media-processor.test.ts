import { createHash } from "node:crypto";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { processBusinessMedia } from "./business-media-processor.js";

describe("business media processor", () => {
  it("rotates, bounds and compresses a cover while preserving its type", async () => {
    const source = await sharp({
      create: {
        background: "#a63d2f",
        channels: 3,
        height: 2000,
        width: 3000
      }
    })
      .jpeg({ quality: 95 })
      .toBuffer();

    const result = await processBusinessMedia({
      bytes: source,
      contentType: "image/jpeg",
      kind: "cover"
    });
    const metadata = await sharp(result.bytes).metadata();

    expect(result).toMatchObject({
      contentType: "image/jpeg",
      height: 1280,
      width: 1920
    });
    expect(metadata.format).toBe("jpeg");
    expect(result.sha256).toBe(
      createHash("sha256").update(result.bytes).digest("hex")
    );
  });

  it("does not enlarge a small logo", async () => {
    const source = await sharp({
      create: {
        background: { alpha: 0.5, b: 30, g: 20, r: 10 },
        channels: 4,
        height: 100,
        width: 300
      }
    })
      .png()
      .toBuffer();

    const result = await processBusinessMedia({
      bytes: source,
      contentType: "image/png",
      kind: "logo"
    });

    expect(result).toMatchObject({
      contentType: "image/png",
      height: 100,
      width: 300
    });
  });

  it("rejects a source whose bytes do not match its declared type", async () => {
    const png = await sharp({
      create: {
        background: "#ffffff",
        channels: 3,
        height: 10,
        width: 10
      }
    })
      .png()
      .toBuffer();

    await expect(
      processBusinessMedia({
        bytes: png,
        contentType: "image/jpeg",
        kind: "reference"
      })
    ).rejects.toThrow("declared image type does not match source bytes");
  });

  it("rejects invalid and oversized sources", async () => {
    await expect(
      processBusinessMedia({
        bytes: Buffer.from("not-an-image"),
        contentType: "image/webp",
        kind: "reference"
      })
    ).rejects.toThrow("business media source cannot be decoded");

    await expect(
      processBusinessMedia({
        bytes: new Uint8Array(12 * 1024 * 1024 + 1),
        contentType: "image/png",
        kind: "reference"
      })
    ).rejects.toThrow("business media source exceeds file limit");
  });
});
