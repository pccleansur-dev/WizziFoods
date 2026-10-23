import { parseCatalogDraft, type CatalogDraft } from "@platform/contracts";

export type PublishCatalogRequest = { expectedDraftRevision: number };
export type AvailabilityRequest = {
  expectedVersion: number | null;
  isAvailable: boolean;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function record(input: unknown): Record<string, unknown> | null {
  return typeof input === "object" && input !== null && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : null;
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]) {
  return Object.keys(value).sort().join() === [...expected].sort().join();
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

export function parseCatalogDraftRequest(input: unknown): CatalogDraft {
  const parsed = parseCatalogDraft(input);
  if (!parsed) throw new Error("Datos de la carta inválidos.");
  return parsed;
}

export function parsePublishCatalogRequest(
  input: unknown
): PublishCatalogRequest {
  const value = record(input);
  if (
    !value ||
    !hasExactKeys(value, ["expectedDraftRevision"]) ||
    !positiveInteger(value.expectedDraftRevision)
  ) {
    throw new Error("Publicación de carta inválida.");
  }
  return { expectedDraftRevision: value.expectedDraftRevision };
}

export function parseAvailabilityRequest(input: unknown): AvailabilityRequest {
  const value = record(input);
  if (
    !value ||
    !hasExactKeys(value, ["expectedVersion", "isAvailable"]) ||
    !(
      value.expectedVersion === null || positiveInteger(value.expectedVersion)
    ) ||
    typeof value.isAvailable !== "boolean"
  ) {
    throw new Error("Cambio de disponibilidad inválido.");
  }
  return {
    expectedVersion: value.expectedVersion as number | null,
    isAvailable: value.isAvailable
  };
}

export function parseCatalogProductId(input: unknown): string {
  if (typeof input !== "string" || !uuidPattern.test(input)) {
    throw new Error("Producto de carta inválido.");
  }
  return input.toLowerCase();
}
