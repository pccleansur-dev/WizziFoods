import { readWebConfig } from "@platform/config";
import { parseCatalogDraft, type CatalogDraft } from "@platform/contracts";

import { createAuthServerClient } from "../../auth/supabase-server";

export type SavedCatalogDraft = {
  basePublishedRevision: number | null;
  draft: CatalogDraft;
  isDirty: boolean;
  revision: number;
  updatedAt: string;
};

export type CatalogAvailability = {
  isAvailable: boolean;
  version: number;
};

export type PublishedCatalog = {
  availability: Record<string, CatalogAvailability>;
  catalog: CatalogDraft;
  publishedAt: string;
  revision: number;
};

function invalidResponse(): never {
  throw new Error("Respuesta de carta inválida.");
}

export function parseCatalogDraftResponse(
  input: unknown
): SavedCatalogDraft | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return invalidResponse();
  }
  const root = input as Record<string, unknown>;
  if (Object.keys(root).length !== 1 || !("data" in root)) invalidResponse();
  if (root.data === null) return null;
  if (!root.data || typeof root.data !== "object" || Array.isArray(root.data)) {
    return invalidResponse();
  }
  const record = root.data as Record<string, unknown>;
  if (
    Object.keys(record).sort().join() !==
    "basePublishedRevision,draft,isDirty,revision,updatedAt"
  ) {
    return invalidResponse();
  }
  const draft = parseCatalogDraft(record.draft);
  if (
    !draft ||
    !Number.isSafeInteger(record.revision) ||
    (record.revision as number) < 1 ||
    typeof record.isDirty !== "boolean" ||
    !(
      record.basePublishedRevision === null ||
      (Number.isSafeInteger(record.basePublishedRevision) &&
        (record.basePublishedRevision as number) > 0)
    ) ||
    record.basePublishedRevision !== draft.baseRevision ||
    typeof record.updatedAt !== "string" ||
    Number.isNaN(Date.parse(record.updatedAt))
  ) {
    return invalidResponse();
  }
  return {
    basePublishedRevision: record.basePublishedRevision as number | null,
    draft,
    isDirty: record.isDirty,
    revision: record.revision as number,
    updatedAt: record.updatedAt
  };
}

export function parsePublishedCatalogResponse(
  input: unknown
): PublishedCatalog | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Respuesta de carta publicada inválida.");
  }
  const root = input as Record<string, unknown>;
  if (Object.keys(root).length !== 1 || !("data" in root)) {
    throw new Error("Respuesta de carta publicada inválida.");
  }
  if (root.data === null) return null;
  if (!root.data || typeof root.data !== "object" || Array.isArray(root.data)) {
    throw new Error("Respuesta de carta publicada inválida.");
  }
  const record = root.data as Record<string, unknown>;
  if (
    Object.keys(record).sort().join() !==
    "availability,catalog,publishedAt,revision"
  ) {
    throw new Error("Respuesta de carta publicada inválida.");
  }
  const catalog = parseCatalogDraft(record.catalog);
  if (
    !catalog ||
    !Number.isSafeInteger(record.revision) ||
    (record.revision as number) < 1 ||
    catalog.baseRevision !== record.revision ||
    typeof record.publishedAt !== "string" ||
    Number.isNaN(Date.parse(record.publishedAt)) ||
    !record.availability ||
    typeof record.availability !== "object" ||
    Array.isArray(record.availability)
  ) {
    throw new Error("Respuesta de carta publicada inválida.");
  }
  const productIds = new Set(catalog.products.map(({ id }) => id));
  const availability: Record<string, CatalogAvailability> = {};
  for (const [productId, rawStatus] of Object.entries(record.availability)) {
    if (
      !productIds.has(productId) ||
      !rawStatus ||
      typeof rawStatus !== "object" ||
      Array.isArray(rawStatus)
    ) {
      throw new Error("Respuesta de carta publicada inválida.");
    }
    const status = rawStatus as Record<string, unknown>;
    if (
      Object.keys(status).sort().join() !== "isAvailable,version" ||
      typeof status.isAvailable !== "boolean" ||
      !Number.isSafeInteger(status.version) ||
      (status.version as number) < 1
    ) {
      throw new Error("Respuesta de carta publicada inválida.");
    }
    availability[productId] = {
      isAvailable: status.isAvailable,
      version: status.version as number
    };
  }
  return {
    availability,
    catalog,
    publishedAt: record.publishedAt,
    revision: record.revision as number
  };
}

export async function loadCatalogDraft(
  host: string
): Promise<
  | { data: SavedCatalogDraft | null; status: "ready" }
  | { status: "unavailable" }
> {
  const supabase = await createAuthServerClient();
  const session = await supabase.auth.getSession();
  const accessToken = session.data.session?.access_token;
  if (session.error || !accessToken || !host) return { status: "unavailable" };
  try {
    const config = readWebConfig(process.env);
    const response = await fetch(`${config.apiUrl}/v1/tenant/catalog/draft`, {
      cache: "no-store",
      headers: { authorization: `Bearer ${accessToken}`, host }
    });
    if (!response.ok) return { status: "unavailable" };
    return {
      data: parseCatalogDraftResponse(await response.json()),
      status: "ready"
    };
  } catch {
    return { status: "unavailable" };
  }
}

export async function loadPublishedCatalog(
  host: string
): Promise<
  { data: PublishedCatalog | null; status: "ready" } | { status: "unavailable" }
> {
  const supabase = await createAuthServerClient();
  const session = await supabase.auth.getSession();
  const accessToken = session.data.session?.access_token;
  if (session.error || !accessToken || !host) return { status: "unavailable" };
  try {
    const config = readWebConfig(process.env);
    const response = await fetch(`${config.apiUrl}/v1/tenant/catalog/current`, {
      cache: "no-store",
      headers: { authorization: `Bearer ${accessToken}`, host }
    });
    if (!response.ok) return { status: "unavailable" };
    return {
      data: parsePublishedCatalogResponse(await response.json()),
      status: "ready"
    };
  } catch {
    return { status: "unavailable" };
  }
}
