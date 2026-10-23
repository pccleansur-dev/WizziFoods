import {
  evaluateBusinessMediaUpload,
  type BusinessMediaKind
} from "@platform/contracts";

export type BusinessMediaReservationRequest = {
  byteLength: number;
  contentType: string;
  kind: BusinessMediaKind;
};

export function parseBusinessMediaReservationRequest(
  input: unknown
): BusinessMediaReservationRequest {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Datos del archivo inválidos.");
  }
  const value = input as Record<string, unknown>;
  if (
    Object.keys(value).sort().join("\0") !==
      ["byteLength", "contentType", "kind"].sort().join("\0") ||
    typeof value.byteLength !== "number" ||
    typeof value.contentType !== "string" ||
    (value.kind !== "cover" &&
      value.kind !== "logo" &&
      value.kind !== "reference")
  ) {
    throw new Error("Datos del archivo inválidos.");
  }
  const decision = evaluateBusinessMediaUpload({
    byteLength: value.byteLength,
    contentType: value.contentType,
    currentTenantBytes: 0
  });
  if (!decision.accepted) throw new Error("Datos del archivo inválidos.");
  return {
    byteLength: value.byteLength,
    contentType: value.contentType,
    kind: value.kind
  };
}
