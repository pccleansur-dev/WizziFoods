import {
  explainCatalogDraft,
  type CatalogDraft,
  type CatalogDraftIssue
} from "@platform/contracts";

import { catalogLanguageName } from "./catalog-localized-fields";
import { trimCatalogText } from "./catalog-editor-state";

export type CatalogIssueView = {
  entity: CatalogDraftIssue["entity"];
  field: string;
  id: string | null;
  language: string | null;
  /** «Producto 2 «Nachos»»: a qué fila de la carta se refiere. */
  label: string;
  message: string;
};

function firstTitle(content: { title: string }[] | undefined): string {
  return content?.find(({ title }) => title.trim())?.title.trim() ?? "";
}

function quoted(title: string): string {
  return title ? ` «${title}»` : "";
}

function labelFor(issue: CatalogDraftIssue, draft: CatalogDraft): string {
  const position = (issue.index ?? 0) + 1;
  switch (issue.entity) {
    case "category":
      return `Categoría ${position}${quoted(firstTitle(draft.categories[issue.index ?? 0]?.content))}`;
    case "sector": {
      const name = draft.sectors[issue.index ?? 0]?.name.trim() ?? "";
      return `Sector ${position}${quoted(name)}`;
    }
    case "product":
      return `Producto ${position}${quoted(firstTitle(draft.products[issue.index ?? 0]?.content))}`;
    case "variant": {
      const parent = draft.products.find((product) =>
        product.variants.some(({ id }) => id === issue.id)
      );
      const variant = parent?.variants.find(({ id }) => id === issue.id);
      const owner = parent ? ` de${quoted(firstTitle(parent.content))}` : "";
      return `Variante ${position}${quoted(firstTitle(variant?.content))}${owner}`;
    }
    default:
      return "Carta";
  }
}

function fieldName(issue: CatalogDraftIssue): string {
  const language = issue.language
    ? ` en ${catalogLanguageName(issue.language)}`
    : "";
  switch (issue.field) {
    case "title":
    case "name":
      return `el nombre${language}`;
    case "description":
      return `la descripción${language}`;
    case "priceCents":
      return "el precio";
    case "priceDeltaCents":
      return "el adicional";
    case "categoryId":
      return "la categoría";
    case "sectorId":
      return "el sector";
    default:
      return "los datos";
  }
}

function messageFor(issue: CatalogDraftIssue): string {
  const what = fieldName(issue);
  switch (issue.code) {
    case "MISSING_NAME":
      return "falta el nombre";
    case "TOO_LONG": {
      const max =
        issue.field === "description"
          ? 1_000
          : issue.entity === "sector"
            ? 80
            : 120;
      return `${what} supera ${max} caracteres`;
    }
    case "INVALID_PRICE":
      return `${what} no es válido`;
    case "UNKNOWN_CATEGORY":
    case "UNKNOWN_SECTOR":
      return `${what} ya no existe`;
    case "DUPLICATE_POSITION":
    case "INVALID_POSITION":
      return "el orden está repetido: reordená la lista";
    case "MISSING_CONTENT":
      return "falta el contenido";
    default:
      return `${what} no es válido`;
  }
}

/**
 * Lo mismo que valida el guardado (después de recortar espacios), pero dicho en
 * castellano y con el lugar exacto: fila, campo e idioma. Un borrador sin
 * problemas devuelve una lista vacía.
 */
export function describeCatalogIssues(draft: CatalogDraft): CatalogIssueView[] {
  return explainCatalogDraft(trimCatalogText(draft)).map((issue) => ({
    entity: issue.entity,
    field: issue.field,
    id: issue.id,
    label: labelFor(issue, draft),
    language: issue.language,
    message: messageFor(issue)
  }));
}

/** Claves `idioma:campo` de los problemas de una fila (idioma vacío si no aplica). */
export function invalidFieldKeys(
  issues: CatalogIssueView[],
  id: string
): ReadonlySet<string> {
  return new Set(
    issues
      .filter((issue) => issue.id === id)
      .map((issue) => `${issue.language ?? ""}:${issue.field}`)
  );
}
