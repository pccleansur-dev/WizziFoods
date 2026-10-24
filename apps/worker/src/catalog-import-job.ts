import type { CatalogImportDraft, TenantScope } from "@platform/contracts";
import type { CatalogImportRepository } from "@platform/database";

import { authorizeTenantJob } from "./tenant-job.js";
import {
  normalizeCatalogImportRows,
  parseCatalogCsv,
  parseCatalogXlsx,
  verifyCatalogImportFile,
  type CatalogImportRow
} from "./catalog-import-processor.js";

export type CatalogImportOcr = (
  bytes: Uint8Array,
  contentType: string
) => Promise<CatalogImportRow[]>;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function importIdFrom(value: unknown): string {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    !("importId" in value) ||
    typeof value.importId !== "string" ||
    !uuidPattern.test(value.importId)
  ) {
    throw new Error("invalid catalog import job payload");
  }
  return value.importId;
}

function sourceFailure(code: string, message: string): CatalogImportDraft {
  return { errors: [{ code, message }], items: [], overallConfidence: 0 };
}

export async function processCatalogImportJob(
  expectedScope: TenantScope,
  value: unknown,
  dependencies: { ocr?: CatalogImportOcr; repository: CatalogImportRepository }
): Promise<void> {
  const envelope = authorizeTenantJob(expectedScope, value);
  if (envelope.kind !== "catalog-import.process") {
    throw new Error("unsupported catalog import job kind");
  }
  const importId = importIdFrom(envelope.payload);
  const claimed = await dependencies.repository.claim({
    importId,
    scope: envelope.scope
  });
  let draft: CatalogImportDraft;
  try {
    if (claimed.source.kind === "manual") {
      draft = normalizeCatalogImportRows(claimed.source.rows, "manual");
    } else {
      const bytes = Buffer.from(claimed.source.contentBase64, "base64");
      verifyCatalogImportFile(
        bytes,
        claimed.source.contentType,
        claimed.source.kind
      );
      if (claimed.source.kind === "csv") {
        draft = normalizeCatalogImportRows(parseCatalogCsv(bytes), "csv");
      } else if (claimed.source.kind === "xlsx") {
        draft = normalizeCatalogImportRows(
          await parseCatalogXlsx(bytes),
          "xlsx"
        );
      } else if (!dependencies.ocr) {
        draft = sourceFailure(
          "OCR_UNAVAILABLE",
          "No hay un lector OCR disponible. Podés continuar con la carga manual."
        );
      } else {
        draft = normalizeCatalogImportRows(
          await dependencies.ocr(bytes, claimed.source.contentType),
          claimed.source.kind
        );
      }
    }
  } catch (error) {
    if (
      error instanceof Error &&
      /(signature|CSV|XLSX|header row|requires nombre)/u.test(error.message)
    ) {
      draft = sourceFailure(
        "INVALID_SOURCE",
        "El archivo no tiene un formato importable o supera los límites permitidos."
      );
    } else {
      throw error;
    }
  }
  await dependencies.repository.complete({
    draft,
    importId,
    scope: envelope.scope
  });
}
