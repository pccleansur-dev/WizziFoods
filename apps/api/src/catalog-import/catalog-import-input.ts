import {
  parseCatalogImportDraft,
  parseCatalogImportRequest,
  type CatalogImportDraft,
  type CatalogImportRequest
} from "@platform/contracts";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function parseCatalogImportId(input: unknown): string {
  if (typeof input !== "string" || !uuidPattern.test(input)) {
    throw new Error("Identificador de importación inválido.");
  }
  return input;
}

export function parseCatalogImportSubmission(
  input: unknown
): CatalogImportRequest {
  const parsed = parseCatalogImportRequest(input);
  if (!parsed) throw new Error("Datos de importación inválidos.");
  return parsed;
}

export function parseCatalogImportApproval(input: unknown): CatalogImportDraft {
  const draft = parseCatalogImportDraft(input);
  if (!draft || draft.items.length < 1) {
    throw new Error("El borrador importado no contiene productos válidos.");
  }
  const unresolved = draft.items.some(
    (item) =>
      !item.category.value ||
      item.category.doubtful ||
      !item.name.value ||
      item.name.doubtful ||
      item.priceCents.value === null ||
      item.priceCents.doubtful ||
      !item.sector.value ||
      item.sector.doubtful
  );
  if (unresolved) {
    throw new Error(
      "Corregí los campos dudosos obligatorios antes de aprobar."
    );
  }
  return draft;
}
