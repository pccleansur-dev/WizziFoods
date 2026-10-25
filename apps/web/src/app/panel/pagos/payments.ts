import {
  parsePaymentMethodStatuses,
  type PaymentMethodKey,
  type PaymentMethodStatus
} from "@platform/contracts";

import { adminApi, dataOf } from "../admin-api";

export type PaymentsActionState = {
  message: string;
  methods: PaymentMethodStatus[] | null;
  status: "error" | "idle" | "invalid" | "saved";
};

export type MercadoPagoConnectionState = {
  authorizationUrl: string | null;
  message: string;
  status: "error" | "redirect";
};

export type PaymentsCommand =
  | {
      enabled: boolean;
      method: PaymentMethodKey;
      publicKey: string | null;
      type: "update";
    }
  | { method: PaymentMethodKey; secret: string; type: "credential" }
  | { method: PaymentMethodKey; type: "clear-credential" };

export function parsePaymentList(body: unknown): PaymentMethodStatus[] {
  const statuses = parsePaymentMethodStatuses(dataOf(body));
  if (!statuses) throw new Error("Respuesta de medios de pago inválida.");
  return statuses;
}

export async function loadPaymentMethods(): Promise<
  | { methods: PaymentMethodStatus[]; status: "ready" }
  | { status: "unavailable" }
> {
  try {
    const result = await adminApi("/v1/tenant/payment-methods");
    if (!result.ok) return { status: "unavailable" };
    return { methods: parsePaymentList(result.body), status: "ready" };
  } catch {
    return { status: "unavailable" };
  }
}
