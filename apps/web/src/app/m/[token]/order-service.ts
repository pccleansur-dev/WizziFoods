import type { OrderServiceStatus } from "@platform/contracts";
import { readWebConfig } from "@platform/config";
import { tenantFetch } from "../../panel/tenant-fetch";

export async function loadOrderService(
  host: string
): Promise<OrderServiceStatus | null> {
  if (!host) return null;
  try {
    const config = readWebConfig(process.env);
    const response = await tenantFetch(
      config.apiUrl + "/v1/public/order-intents/service",
      { cache: "no-store", headers: { host } }
    );
    return response.ok
      ? ((await response.json()) as { data: OrderServiceStatus }).data
      : null;
  } catch {
    return null;
  }
}
