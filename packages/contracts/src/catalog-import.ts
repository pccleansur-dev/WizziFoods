export const CATALOG_IMPORT_MAX_BYTES = 8 * 1024 * 1024;

export type CatalogImportFileKind = "csv" | "image" | "pdf" | "xlsx";
export type CatalogImportSourceKind = CatalogImportFileKind | "manual";
export type CatalogImportStatus =
  "approved" | "discarded" | "failed" | "processing" | "queued" | "review";

export type CatalogImportManualRow = {
  category: string;
  description: string;
  name: string;
  price: string;
  sector: string;
};

export type CatalogImportFileSource = {
  byteLength: number;
  contentBase64: string;
  contentType: string;
  fileName: string;
  kind: CatalogImportFileKind;
};

export type CatalogImportSource =
  CatalogImportFileSource | { kind: "manual"; rows: CatalogImportManualRow[] };

export type CatalogImportRequest = {
  idempotencyKey: string;
  source: CatalogImportSource;
};

export type CatalogImportField<T> = {
  confidence: number;
  doubtful: boolean;
  value: T;
};

export type CatalogImportDraftItem = {
  category: CatalogImportField<string>;
  description: CatalogImportField<string>;
  id: string;
  issues: string[];
  name: CatalogImportField<string>;
  priceCents: CatalogImportField<number | null>;
  rowNumber: number;
  sector: CatalogImportField<string>;
};

export type CatalogImportError = {
  code: string;
  message: string;
  rowNumber?: number;
};

export type CatalogImportDraft = {
  errors: CatalogImportError[];
  items: CatalogImportDraftItem[];
  overallConfidence: number;
};

export type CatalogImportUploadRejection =
  "empty" | "too_large" | "unsupported_type";
export type CatalogImportUploadDecision =
  | { accepted: true }
  | { accepted: false; reason: CatalogImportUploadRejection };

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const base64Pattern =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const errorCodePattern = /^[A-Z][A-Z0-9_]{1,63}$/u;

const filePolicies: Record<
  CatalogImportFileKind,
  { extensions: string[]; types: string[] }
> = {
  csv: { extensions: [".csv"], types: ["text/csv"] },
  image: {
    extensions: [".jpg", ".jpeg", ".png", ".webp"],
    types: ["image/jpeg", "image/png", "image/webp"]
  },
  pdf: { extensions: [".pdf"], types: ["application/pdf"] },
  xlsx: {
    extensions: [".xlsx"],
    types: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]
  }
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function exact(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).sort().join("\0") === keys.sort().join("\0");
}

function boundedTrimmed(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value === value.trim() &&
    value.length <= maximum
  );
}

function confidence(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

function parseField<T>(
  value: unknown,
  parseValue: (candidate: unknown) => T | undefined
): CatalogImportField<T> | null {
  const candidate = record(value);
  if (!candidate || !exact(candidate, ["confidence", "doubtful", "value"])) {
    return null;
  }
  const parsedValue = parseValue(candidate.value);
  return confidence(candidate.confidence) &&
    typeof candidate.doubtful === "boolean" &&
    parsedValue !== undefined
    ? {
        confidence: candidate.confidence,
        doubtful: candidate.doubtful,
        value: parsedValue
      }
    : null;
}

export function evaluateCatalogImportUpload(input: {
  byteLength: number;
  contentType: string;
  fileName: string;
  kind: CatalogImportFileKind;
}): CatalogImportUploadDecision {
  if (!Number.isSafeInteger(input.byteLength) || input.byteLength < 1) {
    return { accepted: false, reason: "empty" };
  }
  if (input.byteLength > CATALOG_IMPORT_MAX_BYTES) {
    return { accepted: false, reason: "too_large" };
  }
  const policy = filePolicies[input.kind];
  const lowerName = input.fileName.toLowerCase();
  if (
    !policy ||
    !policy.types.includes(input.contentType.toLowerCase()) ||
    !policy.extensions.some((extension) => lowerName.endsWith(extension))
  ) {
    return { accepted: false, reason: "unsupported_type" };
  }
  return { accepted: true };
}

export function parseCatalogImportRequest(
  input: unknown
): CatalogImportRequest | null {
  const candidate = record(input);
  const source = candidate ? record(candidate.source) : null;
  if (
    !candidate ||
    !exact(candidate, ["idempotencyKey", "source"]) ||
    typeof candidate.idempotencyKey !== "string" ||
    !uuidPattern.test(candidate.idempotencyKey) ||
    !source ||
    typeof source.kind !== "string"
  ) {
    return null;
  }
  if (source.kind === "manual") {
    if (
      !exact(source, ["kind", "rows"]) ||
      !Array.isArray(source.rows) ||
      source.rows.length < 1 ||
      source.rows.length > 500
    ) {
      return null;
    }
    const rows: CatalogImportManualRow[] = [];
    for (const rawRow of source.rows) {
      const row = record(rawRow);
      if (
        !row ||
        !exact(row, ["category", "description", "name", "price", "sector"]) ||
        !boundedTrimmed(row.category, 120) ||
        !boundedTrimmed(row.description, 1_000) ||
        !boundedTrimmed(row.name, 120) ||
        !boundedTrimmed(row.price, 40) ||
        !boundedTrimmed(row.sector, 80) ||
        row.name.length < 1
      ) {
        return null;
      }
      rows.push({
        category: row.category,
        description: row.description,
        name: row.name,
        price: row.price,
        sector: row.sector
      });
    }
    return {
      idempotencyKey: candidate.idempotencyKey,
      source: { kind: "manual", rows }
    };
  }
  if (
    source.kind !== "csv" &&
    source.kind !== "xlsx" &&
    source.kind !== "pdf" &&
    source.kind !== "image"
  ) {
    return null;
  }
  if (
    !exact(source, [
      "byteLength",
      "contentBase64",
      "contentType",
      "fileName",
      "kind"
    ]) ||
    typeof source.byteLength !== "number" ||
    typeof source.contentBase64 !== "string" ||
    typeof source.contentType !== "string" ||
    typeof source.fileName !== "string" ||
    source.fileName !== source.fileName.trim() ||
    source.fileName.length < 1 ||
    source.fileName.length > 180 ||
    !base64Pattern.test(source.contentBase64)
  ) {
    return null;
  }
  const decision = evaluateCatalogImportUpload({
    byteLength: source.byteLength,
    contentType: source.contentType,
    fileName: source.fileName,
    kind: source.kind
  });
  if (!decision.accepted) return null;
  const decodedLength = Buffer.from(source.contentBase64, "base64").byteLength;
  if (decodedLength !== source.byteLength) return null;
  return {
    idempotencyKey: candidate.idempotencyKey,
    source: {
      byteLength: source.byteLength,
      contentBase64: source.contentBase64,
      contentType: source.contentType,
      fileName: source.fileName,
      kind: source.kind
    }
  };
}

export function parseCatalogImportDraft(
  input: unknown
): CatalogImportDraft | null {
  const candidate = record(input);
  if (
    !candidate ||
    !exact(candidate, ["errors", "items", "overallConfidence"]) ||
    !confidence(candidate.overallConfidence) ||
    !Array.isArray(candidate.errors) ||
    candidate.errors.length > 500 ||
    !Array.isArray(candidate.items) ||
    candidate.items.length > 500
  ) {
    return null;
  }
  const errors: CatalogImportError[] = [];
  for (const value of candidate.errors) {
    const error = record(value);
    const keys =
      error && "rowNumber" in error
        ? ["code", "message", "rowNumber"]
        : ["code", "message"];
    if (
      !error ||
      !exact(error, keys) ||
      typeof error.code !== "string" ||
      !errorCodePattern.test(error.code) ||
      !boundedTrimmed(error.message, 300) ||
      error.message.length < 1 ||
      ("rowNumber" in error &&
        (!Number.isSafeInteger(error.rowNumber) ||
          (error.rowNumber as number) < 1))
    ) {
      return null;
    }
    errors.push({
      code: error.code,
      message: error.message,
      ...(typeof error.rowNumber === "number"
        ? { rowNumber: error.rowNumber }
        : {})
    });
  }
  const items: CatalogImportDraftItem[] = [];
  for (const value of candidate.items) {
    const item = record(value);
    if (
      !item ||
      !exact(item, [
        "category",
        "description",
        "id",
        "issues",
        "name",
        "priceCents",
        "rowNumber",
        "sector"
      ]) ||
      typeof item.id !== "string" ||
      !uuidPattern.test(item.id) ||
      !Number.isSafeInteger(item.rowNumber) ||
      (item.rowNumber as number) < 1 ||
      !Array.isArray(item.issues) ||
      item.issues.length > 20 ||
      item.issues.some(
        (issue) => typeof issue !== "string" || !errorCodePattern.test(issue)
      )
    ) {
      return null;
    }
    const stringValue = (maximum: number) => (raw: unknown) =>
      boundedTrimmed(raw, maximum) ? raw : undefined;
    const category = parseField(item.category, stringValue(120));
    const description = parseField(item.description, stringValue(1_000));
    const name = parseField(item.name, stringValue(120));
    const sector = parseField(item.sector, stringValue(80));
    const priceCents = parseField<number | null>(item.priceCents, (raw) =>
      raw === null ||
      (Number.isSafeInteger(raw) &&
        (raw as number) >= 0 &&
        (raw as number) <= 1_000_000_000)
        ? (raw as number | null)
        : undefined
    );
    if (
      !category ||
      !description ||
      !name ||
      !priceCents ||
      !sector ||
      name.value.length < 1
    ) {
      return null;
    }
    items.push({
      category,
      description,
      id: item.id,
      issues: [...new Set(item.issues as string[])],
      name,
      priceCents,
      rowNumber: item.rowNumber as number,
      sector
    });
  }
  return { errors, items, overallConfidence: candidate.overallConfidence };
}
