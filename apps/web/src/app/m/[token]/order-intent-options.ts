import { readWebConfig } from "@platform/config";

import { tenantFetch } from "../../panel/tenant-fetch";
import {
  parseOrderIntentOptionsResponse,
  type OrderIntentPaymentMethod
} from "./order-intent";

export async function loadOrderIntentOptions(
  host: string
): Promise<OrderIntentPaymentMethod[]> {
  if (!host) return [];
  try {
    const config = readWebConfig(process.env);
    const response = await tenantFetch(
      `${config.apiUrl}/v1/public/order-intents/options`,
      { cache: "no-store", headers: { host } }
    );
    if (!response.ok) return [];
    return parseOrderIntentOptionsResponse(await response.json()) ?? [];
  } catch {
    return [];
  }
}
