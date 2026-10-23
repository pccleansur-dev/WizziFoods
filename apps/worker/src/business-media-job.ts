import {
  businessMediaObjectPath,
  type BusinessMediaKind,
  type TenantScope
} from "@platform/contracts";

import {
  InvalidBusinessMediaError,
  processBusinessMedia
} from "./business-media-processor.js";
import { authorizeTenantJob } from "./tenant-job.js";

type BusinessMediaContentType = "image/jpeg" | "image/png" | "image/webp";

export type ClaimedBusinessMedia = {
  contentType: BusinessMediaContentType;
  kind: BusinessMediaKind;
  objectPath: string;
};

export interface BusinessMediaJobRepository {
  claim(scope: TenantScope, assetId: string): Promise<ClaimedBusinessMedia>;
  complete(
    scope: TenantScope,
    assetId: string,
    metadata: {
      height: number;
      sha256: string;
      storedSizeBytes: number;
      width: number;
    }
  ): Promise<void>;
  fail(scope: TenantScope, assetId: string): Promise<void>;
}

export interface BusinessMediaJobStorage {
  download(objectPath: string): Promise<Uint8Array>;
  replace(
    objectPath: string,
    bytes: Uint8Array,
    contentType: BusinessMediaContentType
  ): Promise<void>;
}

type BusinessMediaJobDependencies = {
  repository: BusinessMediaJobRepository;
  storage: BusinessMediaJobStorage;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function parseAssetId(payload: unknown): string {
  if (
    typeof payload !== "object" ||
    payload === null ||
    Object.keys(payload).length !== 1 ||
    !("assetId" in payload) ||
    typeof payload.assetId !== "string" ||
    !uuidPattern.test(payload.assetId)
  ) {
    throw new Error("invalid business media job payload");
  }
  return payload.assetId;
}

function extensionFor(contentType: BusinessMediaContentType) {
  return contentType === "image/jpeg"
    ? "jpg"
    : contentType === "image/png"
      ? "png"
      : "webp";
}

export async function processBusinessMediaJob(
  expectedScope: TenantScope,
  value: unknown,
  dependencies: BusinessMediaJobDependencies
): Promise<"failed" | "ready"> {
  const envelope = authorizeTenantJob(expectedScope, value);
  if (envelope.kind !== "business-media.process") {
    throw new Error("unsupported business media job kind");
  }
  const assetId = parseAssetId(envelope.payload);
  const asset = await dependencies.repository.claim(envelope.scope, assetId);
  const expectedPath = businessMediaObjectPath({
    assetId,
    extension: extensionFor(asset.contentType),
    kind: asset.kind,
    scope: envelope.scope
  });
  if (asset.objectPath !== expectedPath) {
    throw new Error("claimed business media path is not canonical");
  }

  try {
    const source = await dependencies.storage.download(asset.objectPath);
    const processed = await processBusinessMedia({
      bytes: source,
      contentType: asset.contentType,
      kind: asset.kind
    });
    await dependencies.storage.replace(
      asset.objectPath,
      processed.bytes,
      processed.contentType
    );
    await dependencies.repository.complete(envelope.scope, assetId, {
      height: processed.height,
      sha256: processed.sha256,
      storedSizeBytes: processed.bytes.byteLength,
      width: processed.width
    });
    return "ready";
  } catch (error) {
    if (!(error instanceof InvalidBusinessMediaError)) throw error;
    await dependencies.repository.fail(envelope.scope, assetId);
    return "failed";
  }
}
