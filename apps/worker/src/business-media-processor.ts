import { createHash } from "node:crypto";

import {
  BUSINESS_MEDIA_POLICY,
  type BusinessMediaKind
} from "@platform/contracts";
import sharp, { type Sharp } from "sharp";

type SupportedBusinessMediaType =
  (typeof BUSINESS_MEDIA_POLICY.supportedContentTypes)[number];

export type ProcessBusinessMediaInput = {
  bytes: Uint8Array;
  contentType: SupportedBusinessMediaType;
  kind: BusinessMediaKind;
};

export type ProcessedBusinessMedia = {
  bytes: Buffer;
  contentType: SupportedBusinessMediaType;
  height: number;
  sha256: string;
  width: number;
};

const expectedFormat: Record<SupportedBusinessMediaType, string> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp"
};

const outputBounds: Record<
  BusinessMediaKind,
  Readonly<{ height: number; width: number }>
> = {
  cover: { height: 1280, width: 1920 },
  logo: { height: 1024, width: 1024 },
  reference: { height: 1600, width: 1600 }
};

function encode(pipeline: Sharp, contentType: SupportedBusinessMediaType): Sharp {
  if (contentType === "image/jpeg") {
    return pipeline.jpeg({ mozjpeg: true, quality: 82 });
  }
  if (contentType === "image/png") {
    return pipeline.png({
      adaptiveFiltering: true,
      compressionLevel: 9,
      palette: true,
      quality: 90
    });
  }
  return pipeline.webp({ effort: 5, quality: 82, smartSubsample: true });
}

export async function processBusinessMedia(
  input: ProcessBusinessMediaInput
): Promise<ProcessedBusinessMedia> {
  if (
    input.bytes.byteLength < 1 ||
    input.bytes.byteLength > BUSINESS_MEDIA_POLICY.maxSourceBytes
  ) {
    throw new Error("business media source exceeds file limit");
  }

  let decoder: Sharp;
  let metadata: Awaited<ReturnType<Sharp["metadata"]>>;
  try {
    decoder = sharp(input.bytes, {
      failOn: "warning",
      limitInputPixels: 40_000_000,
      sequentialRead: true
    });
    metadata = await decoder.metadata();
  } catch {
    throw new Error("business media source cannot be decoded");
  }

  if (
    metadata.format !== expectedFormat[input.contentType] ||
    !metadata.width ||
    !metadata.height ||
    (metadata.pages ?? 1) !== 1
  ) {
    throw new Error("declared image type does not match source bytes");
  }

  const bounds = outputBounds[input.kind];
  const { data, info } = await encode(
    decoder.rotate().resize({
      fit: "inside",
      height: bounds.height,
      width: bounds.width,
      withoutEnlargement: true
    }),
    input.contentType
  ).toBuffer({ resolveWithObject: true });

  return {
    bytes: data,
    contentType: input.contentType,
    height: info.height,
    sha256: createHash("sha256").update(data).digest("hex"),
    width: info.width
  };
}
