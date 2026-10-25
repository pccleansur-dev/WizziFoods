/** In-person methods only: online payments are a later task (T24). */
export type AccountPaymentMethod =
  "cash" | "credit_card" | "debit_card" | "other_in_person";

export type RecordPaymentRequest = {
  /** Null collects the whole pending balance. */
  amountCents: number | null;
  commandId: string;
  method: AccountPaymentMethod;
  tipCents: number;
};

/** An amount in cents, or a percentage of the pending balance in basis points. */
export type ApplyDiscountRequest = {
  commandId: string;
  kind: "amount" | "percent";
  reason: string;
  value: number;
};

export type KeepOpenRequest = { commandId: string };

export type PaymentResult = {
  amountCents: number;
  /** The payment's own id: a refund points at it. */
  paymentId: string;
  paymentCents: number;
  pendingCents: number;
  sessionId: string;
  /** The register shift the collection belongs to. */
  shiftId: string;
  tipCents: number;
};

export type DiscountResult = {
  discountCents: number;
  pendingCents: number;
  sessionId: string;
};

export type KeepOpenResult = {
  decision: "keep_open";
  pendingCents: number;
  sessionId: string;
};

export type AccountMovementKind =
  "adjustment" | "charge" | "discount" | "payment" | "refund" | "tip";

export type AccountSummary = {
  consumedCents: number;
  discountCents: number;
  paidCents: number;
  /** Always consumed - discounts + tips - paid + refunded. */
  pendingCents: number;
  refundedCents: number;
  tipCents: number;
};

export type AccountEntryView = {
  amountCents: number;
  cause: string;
  createdAt: string;
  id: number;
  kind: AccountMovementKind;
  origin: string;
  paymentMethod: AccountPaymentMethod | null;
  /** Id of the movement's source; a payment's id is what a refund points at. */
  sourceId: string;
};

export type WaiterAccount = {
  currency: "ARS";
  entries: AccountEntryView[];
  keptOpen: boolean;
  openedAt: string;
  sessionId: string;
  summary: AccountSummary;
  tableId: string;
  tableLabels: string[];
};

export type WaiterAccountsView = {
  accounts: WaiterAccount[];
  /** Whether a register shift is open: nobody collects while it is closed. */
  cashRegisterOpen: boolean;
  generatedAt: string;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

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

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : null;
}

function positive(value: unknown): number | null {
  const parsed = integer(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function nonNegative(value: unknown): number | null {
  const parsed = integer(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
}

function bounded(value: unknown, maximumLength: number): string | null {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumLength
    ? value
    : null;
}

function reason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= 200 ? trimmed : null;
}

function timestamp(value: unknown): string | null {
  return typeof value === "string" &&
    !Number.isNaN(new Date(value).getTime()) &&
    new Date(value).toISOString() === value
    ? value
    : null;
}

const methods: readonly AccountPaymentMethod[] = [
  "cash",
  "credit_card",
  "debit_card",
  "other_in_person"
];
const kinds: readonly AccountMovementKind[] = [
  "charge",
  "discount",
  "payment",
  "tip",
  "adjustment",
  "refund"
];

function method(value: unknown): AccountPaymentMethod | null {
  return methods.find((entry) => entry === value) ?? null;
}

export function parseRecordPaymentRequest(
  input: unknown
): RecordPaymentRequest | null {
  const candidate = record(input);
  if (
    !candidate ||
    !hasExactKeys(candidate, ["amountCents", "commandId", "method", "tipCents"])
  ) {
    return null;
  }
  const commandId = uuid(candidate.commandId);
  const paymentMethod = method(candidate.method);
  const amountCents =
    candidate.amountCents === null ? null : positive(candidate.amountCents);
  const tipCents = nonNegative(candidate.tipCents);
  if (
    !commandId ||
    !paymentMethod ||
    (candidate.amountCents !== null && amountCents === null) ||
    tipCents === null ||
    tipCents > 100_000_000
  ) {
    return null;
  }
  return { amountCents, commandId, method: paymentMethod, tipCents };
}

export function parseApplyDiscountRequest(
  input: unknown
): ApplyDiscountRequest | null {
  const candidate = record(input);
  if (
    !candidate ||
    !hasExactKeys(candidate, ["commandId", "kind", "reason", "value"]) ||
    (candidate.kind !== "amount" && candidate.kind !== "percent")
  ) {
    return null;
  }
  const commandId = uuid(candidate.commandId);
  const text = reason(candidate.reason);
  const value = positive(candidate.value);
  if (
    !commandId ||
    !text ||
    value === null ||
    (candidate.kind === "percent" && value > 10_000)
  ) {
    return null;
  }
  return { commandId, kind: candidate.kind, reason: text, value };
}

export function parseKeepOpenRequest(input: unknown): KeepOpenRequest | null {
  const candidate = record(input);
  if (!candidate || !hasExactKeys(candidate, ["commandId"])) return null;
  const commandId = uuid(candidate.commandId);
  return commandId ? { commandId } : null;
}

export function parsePaymentResult(input: unknown): PaymentResult | null {
  const root = record(input);
  if (
    !root ||
    !hasExactKeys(root, [
      "amountCents",
      "paymentCents",
      "paymentId",
      "pendingCents",
      "sessionId",
      "shiftId",
      "tipCents"
    ])
  ) {
    return null;
  }
  const amountCents = positive(root.amountCents);
  const paymentCents = positive(root.paymentCents);
  const paymentId = uuid(root.paymentId);
  const pendingCents = integer(root.pendingCents);
  const sessionId = uuid(root.sessionId);
  const shiftId = uuid(root.shiftId);
  const tipCents = nonNegative(root.tipCents);
  if (
    amountCents === null ||
    paymentCents === null ||
    !paymentId ||
    pendingCents === null ||
    !sessionId ||
    !shiftId ||
    tipCents === null ||
    paymentCents !== amountCents + tipCents
  ) {
    return null;
  }
  return {
    amountCents,
    paymentCents,
    paymentId,
    pendingCents,
    sessionId,
    shiftId,
    tipCents
  };
}

export function parseDiscountResult(input: unknown): DiscountResult | null {
  const root = record(input);
  if (
    !root ||
    !hasExactKeys(root, ["discountCents", "pendingCents", "sessionId"])
  ) {
    return null;
  }
  const discountCents = positive(root.discountCents);
  const pendingCents = integer(root.pendingCents);
  const sessionId = uuid(root.sessionId);
  if (discountCents === null || pendingCents === null || !sessionId) {
    return null;
  }
  return { discountCents, pendingCents, sessionId };
}

export function parseKeepOpenResult(input: unknown): KeepOpenResult | null {
  const root = record(input);
  if (
    !root ||
    !hasExactKeys(root, ["decision", "pendingCents", "sessionId"]) ||
    root.decision !== "keep_open"
  ) {
    return null;
  }
  const pendingCents = integer(root.pendingCents);
  const sessionId = uuid(root.sessionId);
  return pendingCents !== null && sessionId
    ? { decision: "keep_open", pendingCents, sessionId }
    : null;
}

function summary(input: unknown): AccountSummary | null {
  const root = record(input);
  if (
    !root ||
    !hasExactKeys(root, [
      "consumedCents",
      "discountCents",
      "paidCents",
      "pendingCents",
      "refundedCents",
      "tipCents"
    ])
  ) {
    return null;
  }
  const consumedCents = integer(root.consumedCents);
  const discountCents = nonNegative(root.discountCents);
  const paidCents = nonNegative(root.paidCents);
  const pendingCents = integer(root.pendingCents);
  const refundedCents = nonNegative(root.refundedCents);
  const tipCents = nonNegative(root.tipCents);
  if (
    consumedCents === null ||
    discountCents === null ||
    paidCents === null ||
    pendingCents === null ||
    refundedCents === null ||
    tipCents === null ||
    // The balance is derived, never free: it must follow from its parts.
    pendingCents !==
      consumedCents - discountCents + tipCents - paidCents + refundedCents
  ) {
    return null;
  }
  return {
    consumedCents,
    discountCents,
    paidCents,
    pendingCents,
    refundedCents,
    tipCents
  };
}

function entry(input: unknown): AccountEntryView | null {
  const root = record(input);
  if (
    !root ||
    !hasExactKeys(root, [
      "amountCents",
      "cause",
      "createdAt",
      "id",
      "kind",
      "origin",
      "paymentMethod",
      "sourceId"
    ])
  ) {
    return null;
  }
  const kind = kinds.find((candidate) => candidate === root.kind);
  const amountCents = integer(root.amountCents);
  const cause = bounded(root.cause, 200);
  const createdAt = timestamp(root.createdAt);
  const id = positive(root.id);
  const origin = bounded(root.origin, 40);
  const sourceId = uuid(root.sourceId);
  const paymentMethod =
    root.paymentMethod === null ? null : method(root.paymentMethod);
  if (
    !kind ||
    amountCents === null ||
    amountCents === 0 ||
    !cause ||
    !createdAt ||
    id === null ||
    !origin ||
    !sourceId ||
    (root.paymentMethod !== null && !paymentMethod) ||
    // Money in raises what the table owes; money out lowers it.
    ((kind === "charge" || kind === "tip" || kind === "refund") &&
      amountCents < 0) ||
    ((kind === "discount" || kind === "payment") && amountCents > 0)
  ) {
    return null;
  }
  return {
    amountCents,
    cause,
    createdAt,
    id,
    kind,
    origin,
    paymentMethod,
    sourceId
  };
}

function account(input: unknown): WaiterAccount | null {
  const root = record(input);
  if (
    !root ||
    !hasExactKeys(root, [
      "currency",
      "entries",
      "keptOpen",
      "openedAt",
      "sessionId",
      "summary",
      "tableId",
      "tableLabels"
    ]) ||
    root.currency !== "ARS" ||
    typeof root.keptOpen !== "boolean" ||
    !Array.isArray(root.entries) ||
    root.entries.length > 200 ||
    !Array.isArray(root.tableLabels) ||
    root.tableLabels.length < 1 ||
    root.tableLabels.length > 20
  ) {
    return null;
  }
  const entries: AccountEntryView[] = [];
  for (const candidate of root.entries) {
    const parsed = entry(candidate);
    if (!parsed) return null;
    entries.push(parsed);
  }
  const labels: string[] = [];
  for (const candidate of root.tableLabels) {
    const label = bounded(candidate, 20);
    if (!label) return null;
    labels.push(label);
  }
  const openedAt = timestamp(root.openedAt);
  const sessionId = uuid(root.sessionId);
  const parsedSummary = summary(root.summary);
  const tableId = uuid(root.tableId);
  if (!openedAt || !sessionId || !parsedSummary || !tableId) return null;
  return {
    currency: "ARS",
    entries,
    keptOpen: root.keptOpen,
    openedAt,
    sessionId,
    summary: parsedSummary,
    tableId,
    tableLabels: labels
  };
}

export function parseWaiterAccountsView(
  input: unknown
): WaiterAccountsView | null {
  const root = record(input);
  if (
    !root ||
    !hasExactKeys(root, ["accounts", "cashRegisterOpen", "generatedAt"]) ||
    typeof root.cashRegisterOpen !== "boolean" ||
    !Array.isArray(root.accounts) ||
    root.accounts.length > 200
  ) {
    return null;
  }
  const generatedAt = timestamp(root.generatedAt);
  if (!generatedAt) return null;
  const accounts: WaiterAccount[] = [];
  for (const candidate of root.accounts) {
    const parsed = account(candidate);
    if (!parsed) return null;
    accounts.push(parsed);
  }
  return { accounts, cashRegisterOpen: root.cashRegisterOpen, generatedAt };
}
