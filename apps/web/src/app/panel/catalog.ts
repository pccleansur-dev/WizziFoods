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
