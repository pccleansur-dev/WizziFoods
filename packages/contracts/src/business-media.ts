import { tenantStoragePrefix, type TenantScope } from "./tenant-scope.js";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export const BUSINESS_MEDIA_POLICY = {
  maxSourceBytes: 12 * 1024 * 1024,
  maxTenantBytes: 1024 * 1024 * 1024,
  supportedContentTypes: ["image/jpeg", "image/png", "image/webp"]
} as const;

export type BusinessMediaKind = "cover" | "logo" | "product" | "reference";
export type BusinessMediaExtension = "jpeg" | "jpg" | "png" | "webp";
export type BusinessMediaUploadRejection =
  | "file_too_large"
  | "invalid_size"
  | "tenant_quota_exceeded"
  | "unsupported_type";

export type BusinessMediaUploadDecision =
  | { accepted: true }
  | { accepted: false; reason: BusinessMediaUploadRejection };

export function evaluateBusinessMediaUpload(input: {
  byteLength: number;
  contentType: string;
  currentTenantBytes: number;
}): BusinessMediaUploadDecision {
  if (
    !Number.isSafeInteger(input.byteLength) ||
    input.byteLength <= 0 ||
    !Number.isSafeInteger(input.currentTenantBytes) ||
    input.currentTenantBytes < 0
  ) {
    return { accepted: false, reason: "invalid_size" };
  }
  if (
    !(
      BUSINESS_MEDIA_POLICY.supportedContentTypes as readonly string[]
    ).includes(input.contentType)
  ) {
    return { accepted: false, reason: "unsupported_type" };
  }
  if (input.byteLength > BUSINESS_MEDIA_POLICY.maxSourceBytes) {
    return { accepted: false, reason: "file_too_large" };
  }
  if (
    input.currentTenantBytes + input.byteLength >
    BUSINESS_MEDIA_POLICY.maxTenantBytes
  ) {
    return { accepted: false, reason: "tenant_quota_exceeded" };
  }
  return { accepted: true };
}

export function businessMediaObjectPath(input: {
  assetId: string;
  extension: BusinessMediaExtension;
  kind: BusinessMediaKind;
  scope: TenantScope;
}): string {
  if (!uuidPattern.test(input.assetId)) {
    throw new Error("assetId must be a UUID");
  }
  if (!(["jpeg", "jpg", "png", "webp"] as string[]).includes(input.extension)) {
    throw new Error("extension must be supported");
  }
  if (
    !(["cover", "logo", "product", "reference"] as string[]).includes(
      input.kind
    )
  ) {
    throw new Error("kind must be supported");
  }
  return `${tenantStoragePrefix(input.scope)}/business-profile/${input.kind}/${input.assetId}.${input.extension}`;
}
