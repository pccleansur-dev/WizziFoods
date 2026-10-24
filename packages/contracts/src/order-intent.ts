import {
  parseDinerDraftRequest,
  type DinerDraftItem,
  type DinerDraftQuoteItem
} from "./diner-draft.js";
import {
  isPaymentMethodKey,
  type PaymentMethodKey
} from "./payment-methods.js";

export type OrderAttribution = "table" | "individual";
export type OrderPaymentPath = "in_person" | "online";

export type OrderIntentRequest = {
  attribution: OrderAttribution;
  commandId: string;
  dinerName: string;
  items: DinerDraftItem[];
  paymentMethod: PaymentMethodKey;
  paymentPath: OrderPaymentPath;
  seatLabel: string | null;
  token: string;
};

export type OrderIntentStatus = "awaiting_waiter" | "payment_pending";

export type OrderIntentResult = {
  callId: string | null;
  intentId: string;
  items: DinerDraftQuoteItem[];
  status: OrderIntentStatus;
  totalCents: number;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown, maximumLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maximumLength
    ? normalized
    : null;
}

export function parseOrderIntentRequest(
  input: unknown
): OrderIntentRequest | null {
  const candidate = record(input);
  if (
    !candidate ||
    Object.keys(candidate).sort().join("\0") !==
      [
        "attribution",
        "commandId",
        "dinerName",
        "items",
        "paymentMethod",
        "paymentPath",
        "seatLabel",
        "token"
      ]
        .sort()
        .join("\0") ||
    (candidate.attribution !== "table" &&
      candidate.attribution !== "individual") ||
    (candidate.paymentPath !== "in_person" &&
      candidate.paymentPath !== "online") ||
    typeof candidate.commandId !== "string" ||
    !uuidPattern.test(candidate.commandId) ||
    !isPaymentMethodKey(candidate.paymentMethod) ||
    (candidate.paymentPath === "online" &&
      candidate.paymentMethod !== "mercado_pago") ||
    (candidate.paymentPath === "in_person" &&
      candidate.paymentMethod === "mercado_pago")
  ) {
    return null;
  }

  const dinerName = text(candidate.dinerName, 80);
  const seatLabel =
    candidate.seatLabel === null ? null : text(candidate.seatLabel, 40);
  const draft = parseDinerDraftRequest({
    items: candidate.items,
    token: candidate.token
  });
  if (
    !dinerName ||
    (candidate.seatLabel !== null && !seatLabel) ||
    (candidate.attribution === "individual" && !seatLabel) ||
    !draft ||
    draft.items.length === 0
  ) {
    return null;
  }

  return {
    attribution: candidate.attribution,
    commandId: candidate.commandId,
    dinerName,
    items: draft.items,
    paymentMethod: candidate.paymentMethod,
    paymentPath: candidate.paymentPath,
    seatLabel,
    token: draft.token
  };
}
