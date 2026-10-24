import {
  isPaymentMethodKey,
  parseOrderIntentRequest,
  parseTenantScope,
  type OrderIntentRequest,
  type OrderIntentResult,
  type OrderPaymentPath,
  type PaymentMethodKey,
  type TenantScope
} from "@platform/contracts";
import type { Sql } from "postgres";

export type AvailablePaymentMethod = {
  method: PaymentMethodKey;
  paymentPath: OrderPaymentPath;
};

export type CreateOrderIntentInput = {
  request: OrderIntentRequest;
  scope: TenantScope;
};

export interface OrderIntentRepository {
  create(input: CreateOrderIntentInput): Promise<OrderIntentResult>;
  listPaymentMethods(scope: TenantScope): Promise<AvailablePaymentMethod[]>;
}

type ResultRow = { result: unknown };
type PaymentMethodRow = { method: unknown; payment_path: unknown };

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function assertScope(value: TenantScope): TenantScope {
  const parsed = parseTenantScope(value);
  if (!parsed) throw new Error("tenant scope must be canonical");
  return parsed;
}

function parseResult(value: unknown): OrderIntentResult {
  const root = record(value);
  if (
    !root ||
    Object.keys(root).sort().join() !==
      "callId,intentId,items,status,totalCents" ||
    !(root.callId === null || typeof root.callId === "string") ||
    typeof root.intentId !== "string" ||
    (root.status !== "awaiting_waiter" && root.status !== "payment_pending") ||
    !Number.isSafeInteger(root.totalCents) ||
    (root.totalCents as number) < 0 ||
    !Array.isArray(root.items)
  ) {
    throw new Error("order intent result must be canonical");
  }
  const items = root.items.map((value) => {
    const item = record(value);
    if (
      !item ||
      Object.keys(item).sort().join() !==
        "lineId,productId,quantity,status,title,totalCents,unitPriceCents,variantId,variantTitle" ||
      typeof item.lineId !== "string" ||
      typeof item.productId !== "string" ||
      !(item.variantId === null || typeof item.variantId === "string") ||
      !Number.isSafeInteger(item.quantity) ||
      item.status !== "available" ||
      typeof item.title !== "string" ||
      !(item.variantTitle === null || typeof item.variantTitle === "string") ||
      !Number.isSafeInteger(item.unitPriceCents) ||
      (item.unitPriceCents as number) < 0 ||
      !Number.isSafeInteger(item.totalCents) ||
      item.totalCents !==
        (item.unitPriceCents as number) * (item.quantity as number)
    ) {
      throw new Error("order intent result must be canonical");
    }
    return item as OrderIntentResult["items"][number];
  });
  if (
    items.reduce((sum, item) => sum + item.totalCents, 0) !== root.totalCents ||
    (root.status === "awaiting_waiter" && root.callId === null) ||
    (root.status === "payment_pending" && root.callId !== null)
  ) {
    throw new Error("order intent result must be canonical");
  }
  return {
    callId: root.callId,
    intentId: root.intentId,
    items,
    status: root.status,
    totalCents: root.totalCents as number
  } as OrderIntentResult;
}

export function createOrderIntentRepository(
  client: Sql
): OrderIntentRepository {
  return {
    async create(input) {
      const scope = assertScope(input.scope);
      const request = parseOrderIntentRequest(input.request);
      if (!request) {
        throw new Error("order intent request must be canonical");
      }
      const [row] = await client<ResultRow[]>`
        select private.create_order_intent(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${request.token},
          ${request.commandId}::uuid,
          ${request.attribution},
          ${request.dinerName},
          ${request.seatLabel},
          ${request.paymentMethod},
          ${request.paymentPath},
          ${JSON.stringify(request.items)}::jsonb
        ) as result
      `;
      return parseResult(row?.result);
    },

    async listPaymentMethods(untrustedScope) {
      const scope = assertScope(untrustedScope);
      const rows = await client<PaymentMethodRow[]>`
        select *
        from private.list_public_payment_methods(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid
        )
      `;
      return rows.map((row) => {
        if (
          !isPaymentMethodKey(row.method) ||
          (row.payment_path !== "in_person" && row.payment_path !== "online") ||
          (row.method === "mercado_pago") !== (row.payment_path === "online")
        ) {
          throw new Error("payment method result must be canonical");
        }
        return { method: row.method, paymentPath: row.payment_path };
      });
    }
  };
}
