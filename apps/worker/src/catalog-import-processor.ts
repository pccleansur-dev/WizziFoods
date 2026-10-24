import { randomUUID } from "node:crypto";

import type {
  CatalogImportDraft,
  CatalogImportManualRow,
  CatalogImportSourceKind
} from "@platform/contracts";

export type CatalogImportRow = CatalogImportManualRow;

const headerAliases: Record<keyof CatalogImportRow, string[]> = {
  category: ["category", "categoria", "categoría"],
  description: ["description", "descripcion", "descripción"],
  name: ["name", "nombre", "producto"],
  price: ["price", "precio"],
  sector: ["sector", "estacion", "estación"]
};

function clean(value: unknown): string {
  return String(value ?? "")
    .replaceAll("\u0000", "")
    .trim()
    .slice(0, 1_000);
}

function unsafeCell(value: string): boolean {
  return /^[=+@-]/u.test(value.trimStart());
}

function confidence(
  value: string,
  required: boolean,
  sourceKind: CatalogImportSourceKind
) {
  if (!value) return required ? 0 : 0.65;
  if (unsafeCell(value)) return 0;
  return sourceKind === "manual" ? 1 : 0.94;
}

function parsePriceCents(value: string): number | null {
  const normalized = value
    .replaceAll(/[^0-9,.-]/gu, "")
    .replaceAll(".", "")
    .replace(",", ".");
  if (!normalized || !/^-?[0-9]+(?:\.[0-9]{1,2})?$/u.test(normalized)) {
    return null;
  }
  const amount = Number(normalized);
  const cents = Math.round(amount * 100);
  return Number.isSafeInteger(cents) && cents >= 0 && cents <= 1_000_000_000
    ? cents
    : null;
}

function field<T>(value: T, score: number) {
  return { confidence: score, doubtful: score < 0.75, value };
}

export function normalizeCatalogImportRows(
  rows: CatalogImportRow[],
  sourceKind: CatalogImportSourceKind,
  createId: () => string = randomUUID
): CatalogImportDraft {
  const items = rows.slice(0, 500).map((raw, index) => {
    const category = clean(raw.category).slice(0, 120);
    const description = clean(raw.description);
    const name = clean(raw.name).slice(0, 120);
    const sector = clean(raw.sector).slice(0, 80);
    const priceCents = parsePriceCents(clean(raw.price));
    const issues: string[] = [];
    if (!category) issues.push("CATEGORY_MISSING");
    if (!name) issues.push("NAME_MISSING");
    if (!sector) issues.push("SECTOR_MISSING");
    if (priceCents === null) issues.push("PRICE_INVALID");
    if ([category, description, name, sector].some(unsafeCell)) {
      issues.push("UNSAFE_CELL_VALUE");
    }
    return {
      category: field(category, confidence(category, true, sourceKind)),
      description: field(
        description,
        confidence(description, false, sourceKind)
      ),
      id: createId(),
      issues,
      name: field(name, confidence(name, true, sourceKind)),
      priceCents: field(
        priceCents,
        priceCents === null ? 0 : sourceKind === "manual" ? 1 : 0.96
      ),
      rowNumber: index + 1,
      sector: field(sector, confidence(sector, true, sourceKind))
    };
  });
  const scores = items.flatMap((item) => [
    item.category.confidence,
    item.description.confidence,
    item.name.confidence,
    item.priceCents.confidence,
    item.sector.confidence
  ]);
  const errors = [
    ...(rows.length > 500
      ? [
          {
            code: "ROW_LIMIT_EXCEEDED",
            message: "Sólo se conservaron las primeras 500 filas."
          }
        ]
      : []),
    ...items.flatMap((item) =>
      item.issues.map((code) => ({
        code,
        message: "Revisá el campo señalado antes de aprobar.",
        rowNumber: item.rowNumber
      }))
    )
  ];
  return {
    errors,
    items,
    overallConfidence:
      scores.length === 0
        ? 0
        : Math.round(
            (scores.reduce((sum, score) => sum + score, 0) / scores.length) *
              100
          ) / 100
  };
}

function parseDelimited(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (quoted) throw new Error("CSV has an unterminated quoted field");
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function rowsFromCells(cells: unknown[][]): CatalogImportRow[] {
  const [rawHeaders, ...dataRows] = cells;
  if (!rawHeaders) throw new Error("Import file has no header row");
  const headers = rawHeaders.map((value) =>
    clean(value).toLocaleLowerCase("es")
  );
  const indexes = Object.fromEntries(
    Object.entries(headerAliases).map(([fieldName, aliases]) => [
      fieldName,
      headers.findIndex((header) => aliases.includes(header))
    ])
  ) as Record<keyof CatalogImportRow, number>;
  if (indexes.name < 0 || indexes.price < 0) {
    throw new Error("Import file requires nombre/producto and precio columns");
  }
  return dataRows
    .filter((values) => values.some((value) => clean(value)))
    .map((values) => ({
      category: indexes.category < 0 ? "" : clean(values[indexes.category]),
      description:
        indexes.description < 0 ? "" : clean(values[indexes.description]),
      name: clean(values[indexes.name]),
      price: clean(values[indexes.price]),
      sector: indexes.sector < 0 ? "" : clean(values[indexes.sector])
    }));
}

export function parseCatalogCsv(bytes: Uint8Array): CatalogImportRow[] {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (text.includes("\u0000")) throw new Error("CSV contains binary data");
  return rowsFromCells(parseDelimited(text.replace(/^\uFEFF/u, "")));
}

export async function parseCatalogXlsx(
  bytes: Uint8Array
): Promise<CatalogImportRow[]> {
  const { readSheet } = await import("read-excel-file/node");
  const rows = await readSheet(Buffer.from(bytes));
  if (rows.length > 501 || rows.some((row) => row.length > 20)) {
    throw new Error("XLSX exceeds the supported row or column limit");
  }
  return rowsFromCells(rows);
}

export function verifyCatalogImportFile(
  bytes: Uint8Array,
  contentType: string,
  kind: "csv" | "image" | "pdf" | "xlsx"
): void {
  const starts = (...values: number[]) =>
    values.every((value, index) => bytes[index] === value);
  const valid =
    (kind === "csv" && contentType === "text/csv" && bytes.byteLength > 0) ||
    (kind === "xlsx" &&
      contentType ===
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" &&
      starts(0x50, 0x4b, 0x03, 0x04)) ||
    (kind === "pdf" &&
      contentType === "application/pdf" &&
      starts(0x25, 0x50, 0x44, 0x46, 0x2d)) ||
    (kind === "image" &&
      ((contentType === "image/jpeg" && starts(0xff, 0xd8, 0xff)) ||
        (contentType === "image/png" && starts(0x89, 0x50, 0x4e, 0x47)) ||
        (contentType === "image/webp" &&
          starts(0x52, 0x49, 0x46, 0x46) &&
          String.fromCharCode(...bytes.slice(8, 12)) === "WEBP")));
  if (!valid)
    throw new Error("catalog import file signature does not match its type");
}
