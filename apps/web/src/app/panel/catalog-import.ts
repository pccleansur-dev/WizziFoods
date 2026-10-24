import { readWebConfig } from "@platform/config";
import {
  parseCatalogImportDraft,
  type CatalogImportDraft,
  type CatalogImportSourceKind,
  type CatalogImportStatus
} from "@platform/contracts";

import { createAuthServerClient } from "../../auth/supabase-server";
import { tenantFetch } from "./tenant-fetch";

export type CatalogImportView = {
  attemptCount: number;
  createdAt: string;
  draft: CatalogImportDraft | null;
  id: string;
  sourceKind: CatalogImportSourceKind;
  status: CatalogImportStatus;
  updatedAt: string;
};

function invalid(): never {
  throw new Error("Respuesta de importación inválida.");
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function parseCatalogImportsResponse(
  input: unknown
): CatalogImportView[] {
  const root = record(input);
  if (
    !root ||
    Object.keys(root).join() !== "data" ||
    !Array.isArray(root.data)
  ) {
    return invalid();
  }
  return root.data.map((value) => {
    const item = record(value);
    if (
      !item ||
      Object.keys(item).sort().join() !==
        "attemptCount,createdAt,draft,id,sourceKind,status,updatedAt" ||
      !Number.isSafeInteger(item.attemptCount) ||
      (item.attemptCount as number) < 0 ||
      typeof item.id !== "string" ||
      typeof item.createdAt !== "string" ||
      Number.isNaN(Date.parse(item.createdAt)) ||
      typeof item.updatedAt !== "string" ||
      Number.isNaN(Date.parse(item.updatedAt)) ||
      !["manual", "csv", "xlsx", "pdf", "image"].includes(
        item.sourceKind as string
      ) ||
      ![
        "queued",
        "processing",
        "review",
        "approved",
        "discarded",
        "failed"
      ].includes(item.status as string)
    ) {
      return invalid();
    }
    const draft =
      item.draft === null ? null : parseCatalogImportDraft(item.draft);
    if (item.draft !== null && !draft) return invalid();
    return {
      attemptCount: item.attemptCount as number,
      createdAt: item.createdAt,
      draft,
      id: item.id,
      sourceKind: item.sourceKind as CatalogImportSourceKind,
      status: item.status as CatalogImportStatus,
      updatedAt: item.updatedAt
    };
  });
}

export async function loadCatalogImports(
  host: string
): Promise<
  { data: CatalogImportView[]; status: "ready" } | { status: "unavailable" }
> {
  const supabase = await createAuthServerClient();
  const session = await supabase.auth.getSession();
  const accessToken = session.data.session?.access_token;
  if (session.error || !accessToken || !host) return { status: "unavailable" };
  try {
    const config = readWebConfig(process.env);
    const response = await tenantFetch(
      `${config.apiUrl}/v1/tenant/catalog-imports`,
      {
        cache: "no-store",
        headers: { authorization: `Bearer ${accessToken}`, host }
      }
    );
    if (!response.ok) return { status: "unavailable" };
    return {
      data: parseCatalogImportsResponse(await response.json()),
      status: "ready"
    };
  } catch {
    return { status: "unavailable" };
  }
}
