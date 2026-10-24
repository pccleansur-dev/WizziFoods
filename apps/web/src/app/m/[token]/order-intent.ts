import { readWebConfig } from "@platform/config";
import {
  isPaymentMethodKey,
  parseDinerDraftRequest,
  type OrderIntentResult,
  type OrderPaymentPath,
  type PaymentMethodKey
} from "@platform/contracts";

import { tenantFetch } from "../../panel/tenant-fetch";

export type OrderIntentPaymentMethod = {
  method: PaymentMethodKey;
  paymentPath: OrderPaymentPath;
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function parseOrderIntentOptionsResponse(
  body: unknown
): OrderIntentPaymentMethod[] | null {
  const root = record(body);
  const data = record(root?.data);
  if (!data || !Array.isArray(data.paymentMethods)) return null;
  const methods: OrderIntentPaymentMethod[] = [];
  for (const value of data.paymentMethods) {
    const item = record(value);
    if (
      !item ||
      Object.keys(item).sort().join() !== "method,paymentPath" ||
      !isPaymentMethodKey(item.method) ||
      (item.paymentPath !== "in_person" && item.paymentPath !== "online") ||
      (item.method === "mercado_pago") !== (item.paymentPath === "online")
    ) {
      return null;
    }
    methods.push({ method: item.method, paymentPath: item.paymentPath });
  }
  return methods;
}

export function parseOrderIntentResponse(
  body: unknown
): OrderIntentResult | null {
  const root = record(body);
  const data = record(root?.data);
  if (
    !data ||
    Object.keys(data).sort().join() !==
      "callId,intentId,items,status,totalCents" ||
    !(data.callId === null || typeof data.callId === "string") ||
    typeof data.intentId !== "string" ||
    (data.status !== "awaiting_waiter" && data.status !== "payment_pending") ||
    !Number.isSafeInteger(data.totalCents) ||
    (data.totalCents as number) < 0 ||
    !Array.isArray(data.items)
  ) {
    return null;
  }
  const selection = parseDinerDraftRequest({
    items: data.items.map((value) => {
      const item = record(value);
      return item
        ? {
            lineId: item.lineId,
            productId: item.productId,
            quantity: item.quantity,
            variantId: item.variantId
          }
        : value;
    }),
    token: "0".repeat(64)
  });
  if (!selection) return null;
  const items: OrderIntentResult["items"] = [];
  for (const [index, value] of data.items.entries()) {
    const item = record(value)!;
    const selected = selection.items[index]!;
    if (
      Object.keys(item).sort().join() !==
        "lineId,productId,quantity,status,title,totalCents,unitPriceCents,variantId,variantTitle" ||
      item.status !== "available" ||
      typeof item.title !== "string" ||
      !(item.variantTitle === null || typeof item.variantTitle === "string") ||
      !Number.isSafeInteger(item.unitPriceCents) ||
      (item.unitPriceCents as number) < 0 ||
      !Number.isSafeInteger(item.totalCents) ||
      item.totalCents !== (item.unitPriceCents as number) * selected.quantity
    ) {
      return null;
    }
    items.push({
      ...selected,
      status: "available",
      title: item.title,
      totalCents: item.totalCents as number,
      unitPriceCents: item.unitPriceCents as number,
      variantTitle: item.variantTitle as string | null
    });
  }
  if (
    items.reduce((sum, item) => sum + item.totalCents, 0) !== data.totalCents ||
    (data.status === "awaiting_waiter" && data.callId === null) ||
    (data.status === "payment_pending" && data.callId !== null)
  ) {
    return null;
  }
  return {
    callId: data.callId as string | null,
    intentId: data.intentId,
    items,
    status: data.status,
    totalCents: data.totalCents as number
  };
}

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
