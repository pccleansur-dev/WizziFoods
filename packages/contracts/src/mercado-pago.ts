/**
 * Mercado Pago (T24): the shapes that cross the API, the database and the web.
 * Every parser is strict: unknown keys, wrong types and out-of-range numbers fail,
 * so a forged body or a stale deployment cannot smuggle data through.
 */

export type OnlinePaymentStatus =
  "approved" | "cancelled" | "created" | "pending" | "rejected";

export type OnlinePaymentFulfillment =
  "closed" | "confirmed" | "needs_refund" | "waiting";

export type ReconcileOutcome =
  | "amount_mismatch"
  | "applied"
  | "ignored"
  | "needs_refund"
  | "stale"
  | "unchanged";

/** What Mercado Pago reports for a payment, as fetched with the business' credential. */
export type ProviderPaymentSnapshot = {
  amountCents: number;
  externalReference: string;
  providerPaymentId: string;
  refundedCents: number;
  status: string;
  statusDetail: string | null;
  updatedAt: string;
};

export type BeginOnlinePaymentResult = {
  amountCents: number;
  externalReference: string;
  fulfillment: OnlinePaymentFulfillment;
  intentId: string;
  paymentId: string;
  refundedCents: number;
  status: OnlinePaymentStatus;
};

export type ReconcileResult = {
  amountCents: number;
  fulfillment: OnlinePaymentFulfillment;
  intentId: string;
  orderId: string | null;
  outcome: ReconcileOutcome;
  paymentId: string;
  refundedCents: number;
  status: OnlinePaymentStatus;
};

/** What the diner sees while the payment is in flight. */
export type OnlinePaymentView = {
  intentId: string;
  intentStatus: "confirmed" | "payment_pending";
  payment: {
    amountCents: number;
    fulfillment: OnlinePaymentFulfillment;
    paymentId: string;
    refundedCents: number;
    status: OnlinePaymentStatus;
    statusDetail: string | null;
  } | null;
  totalCents: number;
};

export type DinerPaymentTarget = { intentId: string; token: string };

export type SandboxOutcome = "approved" | "pending" | "rejected";

/** The diner pays either with the Bricks card form or, in sandbox, a chosen outcome. */
export type OnlinePaymentMethodInput =
  | {
      card: {
        installments: number;
        issuerId: string | null;
        payerEmail: string;
        paymentMethodId: string;
        token: string;
      };
      kind: "card";
    }
  | { kind: "sandbox"; outcome: SandboxOutcome };

export type PayOnlinePaymentRequest = DinerPaymentTarget & {
  method: OnlinePaymentMethodInput;
};

export type OnlineCheckout = {
  mode: "live" | "sandbox";
  payment: BeginOnlinePaymentResult;
  publicKey: string | null;
};

export type OnlineRefundRequest = {
  amountCents: number;
  commandId: string;
  paymentId: string;
  reason: string;
};

export type OnlineRefundResult = {
  paymentId: string;
  /** Everything Mercado Pago has returned of this payment so far. */
  refundedCents: number;
};

/** A notification only says "payment X changed"; the state is fetched, never read from it. */
export type MercadoPagoNotification = {
  dataId: string;
  notificationId: string;
  topic: string;
  userId: string;
};

export type MercadoPagoConnectResult = { authorizationUrl: string };

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const tokenPattern = /^[0-9a-f]{64}$/u;
const providerIdPattern = /^[0-9A-Za-z_-]{1,64}$/u;
const maximumCents = 1_000_000_000;

const statuses: readonly OnlinePaymentStatus[] = [
  "approved",
  "cancelled",
  "created",
  "pending",
  "rejected"
];
const fulfillments: readonly OnlinePaymentFulfillment[] = [
  "closed",
  "confirmed",
  "needs_refund",
  "waiting"
];
const outcomes: readonly ReconcileOutcome[] = [
  "amount_mismatch",
  "applied",
  "ignored",
  "needs_refund",
  "stale",
  "unchanged"
];
/** Everything Mercado Pago can report for a payment, as the SQL reconciler knows it. */
export const providerPaymentStatuses = [
  "approved",
  "authorized",
  "cancelled",
  "charged_back",
  "in_mediation",
  "in_process",
  "pending",
  "refunded",
  "rejected"
] as const;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: string[]
): boolean {
  return Object.keys(value).sort().join("\0") === expected.sort().join("\0");
}

function uuid(value: unknown): string | null {
  return typeof value === "string" && uuidPattern.test(value) ? value : null;
}

function cents(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= maximumCents
    ? value
    : null;
}

function positiveCents(value: unknown): number | null {
  const parsed = cents(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[]
): T | null {
  return typeof value === "string" &&
    (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

function timestamp(value: unknown): string | null {
  return typeof value === "string" &&
    !Number.isNaN(new Date(value).getTime()) &&
    new Date(value).toISOString() === value
    ? value
    : null;
}

function nullableText(
  value: unknown,
  maximumLength: number
): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" &&
    value.length >= 1 &&
    value.length <= maximumLength
    ? value
    : undefined;
}

export function isTableToken(value: unknown): value is string {
  return typeof value === "string" && tokenPattern.test(value);
}

export function parseProviderPaymentSnapshot(
  input: unknown
): ProviderPaymentSnapshot | null {
  const root = record(input);
  if (
    !root ||
    !hasExactKeys(root, [
      "amountCents",
      "externalReference",
      "providerPaymentId",
      "refundedCents",
      "status",
      "statusDetail",
      "updatedAt"
    ])
  ) {
    return null;
  }
  const amountCents = positiveCents(root.amountCents);
  const refundedCents = cents(root.refundedCents);
  const status = oneOf(root.status, providerPaymentStatuses);
  const statusDetail = nullableText(root.statusDetail, 100);
  const updatedAt = timestamp(root.updatedAt);
  if (
    amountCents === null ||
    refundedCents === null ||
    refundedCents > amountCents ||
    !status ||
    statusDetail === undefined ||
    !updatedAt ||
    typeof root.externalReference !== "string" ||
    !uuidPattern.test(root.externalReference) ||
    typeof root.providerPaymentId !== "string" ||
    !providerIdPattern.test(root.providerPaymentId)
  ) {
    return null;
  }
  return {
    amountCents,
    externalReference: root.externalReference,
    providerPaymentId: root.providerPaymentId,
    refundedCents,
    status,
    statusDetail,
    updatedAt
  };
}

export function parseBeginOnlinePaymentResult(
  input: unknown
): BeginOnlinePaymentResult | null {
  const root = record(input);
  if (
    !root ||
    !hasExactKeys(root, [
      "amountCents",
      "externalReference",
      "fulfillment",
      "intentId",
      "paymentId",
      "refundedCents",
      "status"
    ])
  ) {
    return null;
  }
  const amountCents = positiveCents(root.amountCents);
  const refundedCents = cents(root.refundedCents);
  const fulfillment = oneOf(root.fulfillment, fulfillments);
  const status = oneOf(root.status, statuses);
  const intentId = uuid(root.intentId);
  const paymentId = uuid(root.paymentId);
  const externalReference = uuid(root.externalReference);
  return amountCents !== null &&
    refundedCents !== null &&
    fulfillment &&
    status &&
    intentId &&
    paymentId &&
    externalReference
    ? {
        amountCents,
        externalReference,
        fulfillment,
        intentId,
        paymentId,
        refundedCents,
        status
      }
    : null;
}

export function parseReconcileResult(input: unknown): ReconcileResult | null {
  const root = record(input);
  if (
    !root ||
    !hasExactKeys(root, [
      "amountCents",
      "fulfillment",
      "intentId",
      "orderId",
      "outcome",
      "paymentId",
      "refundedCents",
      "status"
    ])
  ) {
    return null;
  }
  const amountCents = positiveCents(root.amountCents);
  const refundedCents = cents(root.refundedCents);
  const fulfillment = oneOf(root.fulfillment, fulfillments);
  const status = oneOf(root.status, statuses);
  const outcome = oneOf(root.outcome, outcomes);
  const intentId = uuid(root.intentId);
  const paymentId = uuid(root.paymentId);
  const orderId = root.orderId === null ? null : uuid(root.orderId);
  return amountCents !== null &&
    refundedCents !== null &&
    fulfillment &&
    status &&
    outcome &&
    intentId &&
    paymentId &&
    orderId !== undefined &&
    (root.orderId === null || orderId !== null)
    ? {
        amountCents,
        fulfillment,
        intentId,
        orderId,
        outcome,
        paymentId,
        refundedCents,
        status
      }
    : null;
}

export function parseOnlinePaymentView(
  input: unknown
): OnlinePaymentView | null {
  const root = record(input);
  if (
    !root ||
    !hasExactKeys(root, ["intentId", "intentStatus", "payment", "totalCents"])
  ) {
    return null;
  }
  const intentId = uuid(root.intentId);
  const intentStatus = oneOf(root.intentStatus, [
    "confirmed",
    "payment_pending"
  ] as const);
  const totalCents = cents(root.totalCents);
  if (!intentId || !intentStatus || totalCents === null) return null;
  if (root.payment === null) {
    return { intentId, intentStatus, payment: null, totalCents };
  }
  const payment = record(root.payment);
  if (
    !payment ||
    !hasExactKeys(payment, [
      "amountCents",
      "fulfillment",
      "paymentId",
      "refundedCents",
      "status",
      "statusDetail"
    ])
  ) {
    return null;
  }
  const amountCents = positiveCents(payment.amountCents);
  const refundedCents = cents(payment.refundedCents);
  const fulfillment = oneOf(payment.fulfillment, fulfillments);
  const status = oneOf(payment.status, statuses);
  const paymentId = uuid(payment.paymentId);
  const statusDetail = nullableText(payment.statusDetail, 100);
  if (
    amountCents === null ||
    refundedCents === null ||
    !fulfillment ||
    !status ||
    !paymentId ||
    statusDetail === undefined
  ) {
    return null;
  }
  return {
    intentId,
    intentStatus,
    payment: {
      amountCents,
      fulfillment,
      paymentId,
      refundedCents,
      status,
      statusDetail
    },
    totalCents
  };
}

export function parseDinerPaymentTarget(
  input: unknown
): DinerPaymentTarget | null {
  const root = record(input);
  if (!root || !hasExactKeys(root, ["intentId", "token"])) return null;
  const intentId = uuid(root.intentId);
  return intentId && isTableToken(root.token)
    ? { intentId, token: root.token }
    : null;
}

export function parsePayOnlinePaymentRequest(
  input: unknown
): PayOnlinePaymentRequest | null {
  const root = record(input);
  if (!root || !hasExactKeys(root, ["intentId", "method", "token"])) {
    return null;
  }
  const intentId = uuid(root.intentId);
  const method = record(root.method);
  if (!intentId || !isTableToken(root.token) || !method) return null;
  if (method.kind === "sandbox") {
    const outcome = oneOf(method.outcome, [
      "approved",
      "pending",
      "rejected"
    ] as const);
    return hasExactKeys(method, ["kind", "outcome"]) && outcome
      ? {
          intentId,
          method: { kind: "sandbox", outcome },
          token: root.token
        }
      : null;
  }
  if (method.kind !== "card" || !hasExactKeys(method, ["card", "kind"])) {
    return null;
  }
  const card = record(method.card);
  if (
    !card ||
    !hasExactKeys(card, [
      "installments",
      "issuerId",
      "payerEmail",
      "paymentMethodId",
      "token"
    ])
  ) {
    return null;
  }
  const issuerId = nullableText(card.issuerId, 32);
  const installments = card.installments;
  if (
    issuerId === undefined ||
    typeof installments !== "number" ||
    !Number.isInteger(installments) ||
    installments < 1 ||
    installments > 24 ||
    typeof card.payerEmail !== "string" ||
    card.payerEmail.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(card.payerEmail) ||
    typeof card.paymentMethodId !== "string" ||
    !/^[a-z0-9_]{1,40}$/u.test(card.paymentMethodId) ||
    typeof card.token !== "string" ||
    !/^[0-9A-Za-z_-]{8,128}$/u.test(card.token)
  ) {
    return null;
  }
  return {
    intentId,
    method: {
      card: {
        installments,
        issuerId,
        payerEmail: card.payerEmail,
        paymentMethodId: card.paymentMethodId,
        token: card.token
      },
      kind: "card"
    },
    token: root.token
  };
}

export function parseOnlineCheckout(input: unknown): OnlineCheckout | null {
  const root = record(input);
  if (!root || !hasExactKeys(root, ["mode", "payment", "publicKey"])) {
    return null;
  }
  const mode = oneOf(root.mode, ["live", "sandbox"] as const);
  const payment = parseBeginOnlinePaymentResult(root.payment);
  const publicKey = nullableText(root.publicKey, 200);
  return mode && payment && publicKey !== undefined
    ? { mode, payment, publicKey }
    : null;
}

export function parseOnlineRefundRequest(
  input: unknown
): OnlineRefundRequest | null {
  const root = record(input);
  if (
    !root ||
    !hasExactKeys(root, ["amountCents", "commandId", "paymentId", "reason"])
  ) {
    return null;
  }
  const amountCents = positiveCents(root.amountCents);
  const commandId = uuid(root.commandId);
  const paymentId = uuid(root.paymentId);
  const reason = typeof root.reason === "string" ? root.reason.trim() : null;
  return amountCents !== null &&
    commandId &&
    paymentId &&
    reason &&
    reason.length <= 200
    ? { amountCents, commandId, paymentId, reason }
    : null;
}

export function parseOnlineRefundResult(
  input: unknown
): OnlineRefundResult | null {
  const root = record(input);
  if (!root || !hasExactKeys(root, ["paymentId", "refundedCents"])) {
    return null;
  }
  const paymentId = uuid(root.paymentId);
  const refundedCents = cents(root.refundedCents);
  return paymentId && refundedCents !== null
    ? { paymentId, refundedCents }
    : null;
}

/**
 * The body of a webhook. Mercado Pago sends more keys than these; only the ones the
 * handler needs are read, and each must have the documented type.
 */
export function parseMercadoPagoNotification(
  input: unknown
): MercadoPagoNotification | null {
  const root = record(input);
  const data = record(root?.data);
  if (!root || !data) return null;
  const dataId = scalarId(data.id);
  const notificationId = scalarId(root.id);
  const userId = scalarId(root.user_id);
  const topic = typeof root.type === "string" ? root.type : null;
  if (
    !dataId ||
    !notificationId ||
    !userId ||
    !topic ||
    !/^[a-z_.]{1,60}$/u.test(topic) ||
    !providerIdPattern.test(dataId) ||
    !/^[0-9]{1,20}$/u.test(userId)
  ) {
    return null;
  }
  return { dataId, notificationId, topic, userId };
}

function scalarId(value: unknown): string | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  return typeof value === "string" && value.length > 0 && value.length <= 64
    ? value
    : null;
}

export function parseMercadoPagoConnectResult(
  input: unknown
): MercadoPagoConnectResult | null {
  const root = record(input);
  if (!root || !hasExactKeys(root, ["authorizationUrl"])) return null;
  try {
    const url = new URL(String(root.authorizationUrl));
    return url.protocol === "https:" || url.protocol === "http:"
      ? { authorizationUrl: url.toString() }
      : null;
  } catch {
    return null;
  }
}
