import { readWebConfig } from "@platform/config";
import { parseGoogleReviewUrl } from "@platform/contracts";

import { tenantFetch } from "../../panel/tenant-fetch";

export async function loadGoogleReview(host: string): Promise<string | null> {
  if (!host) return null;
  try {
    const { apiUrl } = readWebConfig(process.env);
    const response = await tenantFetch(
      apiUrl + "/v1/public/order-intents/google-review",
      { cache: "no-store", headers: { host } }
    );
    if (!response.ok) return null;
    const body = (await response.json()) as { data?: unknown };
    return parseGoogleReviewUrl(body.data);
  } catch {
    return null;
  }
}
