import type { BusinessMediaKind } from "@platform/contracts";

export type BusinessMediaStatus = {
  assetId: string;
  kind: BusinessMediaKind;
  status: "failed" | "processing" | "ready";
};

export type BusinessMediaReservation = {
  contentType: "image/jpeg" | "image/png" | "image/webp";
  expiresAt: string;
  id: string;
  kind: BusinessMediaKind;
  objectPath: string;
  sourceSizeBytes: number;
  status: "reserved";
  uploadUrl: string;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function dataRecord(value: unknown): Record<string, unknown> {
  const root = record(value);
  const data =
    root && Object.keys(root).length === 1 ? record(root.data) : null;
  if (!data) throw new Error("Respuesta de archivo inválida.");
  return data;
}

function isKind(value: unknown): value is BusinessMediaKind {
  return value === "cover" || value === "logo" || value === "reference";
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).sort().join("\0") === keys.sort().join("\0");
}

export function parseBusinessMediaReservation(
  value: unknown
): BusinessMediaReservation {
  const data = dataRecord(value);
  let uploadUrl: URL;
  try {
    uploadUrl = new URL(String(data.uploadUrl));
  } catch {
    throw new Error("Respuesta de archivo inválida.");
  }
  if (
    !hasExactKeys(data, [
      "contentType",
      "expiresAt",
      "id",
      "kind",
      "objectPath",
      "sourceSizeBytes",
      "status",
      "uploadUrl"
    ]) ||
    !uuidPattern.test(String(data.id)) ||
    !isKind(data.kind) ||
    data.status !== "reserved" ||
    (data.contentType !== "image/jpeg" &&
      data.contentType !== "image/png" &&
      data.contentType !== "image/webp") ||
    !Number.isSafeInteger(data.sourceSizeBytes) ||
    (data.sourceSizeBytes as number) < 1 ||
    typeof data.objectPath !== "string" ||
    !data.objectPath ||
    typeof data.expiresAt !== "string" ||
    Number.isNaN(Date.parse(data.expiresAt)) ||
    (uploadUrl.protocol !== "http:" && uploadUrl.protocol !== "https:")
  ) {
    throw new Error("Respuesta de archivo inválida.");
  }
  return data as BusinessMediaReservation;
}

export function parseBusinessMediaStatus(value: unknown): BusinessMediaStatus {
  const data = dataRecord(value);
  if (
    !hasExactKeys(data, ["assetId", "kind", "status"]) ||
    !uuidPattern.test(String(data.assetId)) ||
    !isKind(data.kind) ||
    (data.status !== "failed" &&
      data.status !== "processing" &&
      data.status !== "ready")
  ) {
    throw new Error("Respuesta de archivo inválida.");
  }
  return data as BusinessMediaStatus;
}
