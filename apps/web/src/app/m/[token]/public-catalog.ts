import { readWebConfig } from "@platform/config";
import { parseCatalogDraft, type CatalogDraft } from "@platform/contracts";

import { tenantFetch } from "../../panel/tenant-fetch";

export type PublicCatalog = {
  availability: Record<string, { isAvailable: boolean; version: number }>;
  catalog: CatalogDraft;
  publishedAt: string;
  revision: number;
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function parsePublicCatalogResponse(
  body: unknown
): PublicCatalog | null {
  const root = record(body);
  const data = record(root?.data);
  const catalog = parseCatalogDraft(data?.catalog);
  const availabilityValue = record(data?.availability);
  if (
    !data ||
    !catalog ||
    !availabilityValue ||
    !Number.isSafeInteger(data.revision) ||
    (data.revision as number) < 1 ||
    typeof data.publishedAt !== "string" ||
    Number.isNaN(Date.parse(data.publishedAt))
  ) {
    return null;
  }

  const availability: PublicCatalog["availability"] = {};
  for (const [productId, value] of Object.entries(availabilityValue)) {
    const status = record(value);
    if (
      !status ||
      Object.keys(status).sort().join() !== "isAvailable,version" ||
      typeof status.isAvailable !== "boolean" ||
      !Number.isSafeInteger(status.version) ||
      (status.version as number) < 1
    ) {
      return null;
    }
    availability[productId] = {
      isAvailable: status.isAvailable,
      version: status.version as number
    };
  }
  return {
    availability,
    catalog,
    publishedAt: data.publishedAt,
    revision: data.revision as number
  };
}

export async function loadPublicCatalog(
  host: string
): Promise<PublicCatalog | null> {
  if (!host) return null;
  try {
    const config = readWebConfig(process.env);
    const response = await tenantFetch(`${config.apiUrl}/v1/public/catalog`, {
      cache: "no-store",
      headers: { host }
    });
    if (!response.ok) return null;
    return parsePublicCatalogResponse(await response.json());
  } catch {
    return null;
  }
}
