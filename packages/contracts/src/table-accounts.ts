/** In-person methods: the only ones staff can register by hand. */
export type AccountPaymentMethod =
  "cash" | "credit_card" | "debit_card" | "other_in_person";

/** What the ledger may show: also the online payment, which only Mercado Pago records. */
export type AccountEntryPaymentMethod = AccountPaymentMethod | "mercado_pago";

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

export type SplitShareStatus = "cancelled" | "claimed" | "open" | "paid";

export type SplitKind = "equal" | "items";

/** An item of the account that still counts, offered to split by consumption. */
export type LiveItem = {
  lineId: string;
  quantity: number;
  title: string;
  totalCents: number;
};

export type SplitShare = {
  amountCents: number;
  /** Items assigned to this share (split by consumption). */
  items: string[];
  /** Who reserved it, or who paid it. */
  payerLabel: string | null;
  position: number;
  status: SplitShareStatus;
};

/** Equal shares of the balance that was pending when the split was made. */
export type AccountSplit = {
  baseCents: number;
  kind: SplitKind;
  parts: number;
  /** Items nobody owns, divided equally (split by consumption). */
  sharedItems: string[];
  shares: SplitShare[];
  splitId: string;
};

export type CreateSplitRequest = { commandId: string; parts: number };

export type CreateSplitResult = {
  pendingCents: number;
  sessionId: string;
  split: AccountSplit;
};

export type PaySharesRequest = {
  commandId: string;
  /** Who is paying, for the waiter's own reference. */
  payerLabel: string | null;
  method: AccountPaymentMethod;
  positions: number[];
  splitId: string;
  tipCents: number;
};

export type PaySharesResult = PaymentResult & {
  positions: number[];
  split: AccountSplit | null;
  splitId: string;
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
  paymentMethod: AccountEntryPaymentMethod | null;
  /** Id of the movement's source; a payment's id is what a refund points at. */
  sourceId: string;
};

export type WaiterAccount = {
  currency: "ARS";
  entries: AccountEntryView[];
  keptOpen: boolean;
  /** Items that still count, for a split by consumption. */
  liveItems: LiveItem[];
  /** The open split of the account, if any. */
  split: AccountSplit | null;
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

function entryMethod(value: unknown): AccountEntryPaymentMethod | null {
  return value === "mercado_pago" ? value : method(value);
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
    root.paymentMethod === null ? null : entryMethod(root.paymentMethod);
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
      "liveItems",
      "openedAt",
      "sessionId",
      "split",
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
  const split = root.split === null ? null : parseAccountSplit(root.split);
  const liveItems = parseLiveItems(root.liveItems);
  if (
    !openedAt ||
    !sessionId ||
    !parsedSummary ||
    !tableId ||
    !liveItems ||
    (root.split !== null && !split)
  ) {
    return null;
  }
  return {
    currency: "ARS",
    entries,
    keptOpen: root.keptOpen,
    liveItems,
    openedAt,
    sessionId,
    split,
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

const shareStatuses: readonly SplitShareStatus[] = [
  "cancelled",
  "claimed",
  "open",
  "paid"
];

function titles(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 200) return null;
  const found: string[] = [];
  for (const entry of value) {
    const title = bounded(entry, 200);
    if (!title) return null;
    found.push(title);
  }
  return found;
}

function parseLiveItems(value: unknown): LiveItem[] | null {
  if (!Array.isArray(value) || value.length > 200) return null;
  const found: LiveItem[] = [];
  for (const candidate of value) {
    const item = record(candidate);
    if (
      !item ||
      !hasExactKeys(item, ["lineId", "quantity", "title", "totalCents"])
    ) {
      return null;
    }
    const lineId = uuid(item.lineId);
    const quantity = positive(item.quantity);
    const title = bounded(item.title, 160);
    const totalCents = positive(item.totalCents);
    if (!lineId || quantity === null || !title || totalCents === null) {
      return null;
    }
    found.push({ lineId, quantity, title, totalCents });
  }
  return found;
}

export function parseAccountSplit(input: unknown): AccountSplit | null {
  const root = record(input);
  if (
    !root ||
    !hasExactKeys(root, [
      "baseCents",
      "kind",
      "parts",
      "sharedItems",
      "shares",
      "splitId"
    ]) ||
    !Array.isArray(root.shares)
  ) {
    return null;
  }
  const baseCents = positive(root.baseCents);
  const parts = integer(root.parts);
  const splitId = uuid(root.splitId);
  const sharedItems = titles(root.sharedItems);
  const kind =
    root.kind === "equal" || root.kind === "items" ? root.kind : null;
  if (
    !kind ||
    !sharedItems ||
    baseCents === null ||
    parts === null ||
    parts < 2 ||
    parts > 20 ||
    !splitId ||
    root.shares.length !== parts
  ) {
    return null;
  }
  const shares: SplitShare[] = [];
  let total = 0;
  for (const [index, candidate] of root.shares.entries()) {
    const share = record(candidate);
    if (
      !share ||
      !hasExactKeys(share, [
        "amountCents",
        "items",
        "payerLabel",
        "position",
        "status"
      ])
    ) {
      return null;
    }
    const amountCents = positive(share.amountCents);
    const items = titles(share.items);
    const status = shareStatuses.find((entry) => entry === share.status);
    const payerLabel =
      share.payerLabel === null ? null : bounded(share.payerLabel, 40);
    if (
      amountCents === null ||
      !items ||
      !status ||
      share.position !== index + 1 ||
      (share.payerLabel !== null && !payerLabel)
    ) {
      return null;
    }
    total += amountCents;
    shares.push({
      amountCents,
      items,
      payerLabel,
      position: index + 1,
      status
    });
  }
  return total === baseCents
    ? { baseCents, kind, parts, sharedItems, shares, splitId }
    : null;
}

export function parseCreateSplitRequest(
  input: unknown
): CreateSplitRequest | null {
  const root = record(input);
  if (!root || !hasExactKeys(root, ["commandId", "parts"])) return null;
  const commandId = uuid(root.commandId);
  const parts = integer(root.parts);
  return commandId && parts !== null && parts >= 2 && parts <= 20
    ? { commandId, parts }
    : null;
}

export function parseCreateSplitResult(
  input: unknown
): CreateSplitResult | null {
  const root = record(input);
  if (!root || !hasExactKeys(root, ["pendingCents", "sessionId", "split"])) {
    return null;
  }
  const pendingCents = positive(root.pendingCents);
  const sessionId = uuid(root.sessionId);
  const split = parseAccountSplit(root.split);
  return pendingCents !== null && sessionId && split
    ? { pendingCents, sessionId, split }
    : null;
}

export function parsePaySharesRequest(input: unknown): PaySharesRequest | null {
  const root = record(input);
  if (
    !root ||
    !hasExactKeys(root, [
      "commandId",
      "method",
      "payerLabel",
      "positions",
      "splitId",
      "tipCents"
    ]) ||
    !Array.isArray(root.positions)
  ) {
    return null;
  }
  const commandId = uuid(root.commandId);
  const splitId = uuid(root.splitId);
  const paymentMethod = method(root.method);
  const tipCents = nonNegative(root.tipCents);
  const payerLabel =
    root.payerLabel === null ? null : bounded(root.payerLabel, 40);
  const positions = root.positions as unknown[];
  if (
    !commandId ||
    !splitId ||
    !paymentMethod ||
    tipCents === null ||
    (root.payerLabel !== null &&
      (!payerLabel || payerLabel !== payerLabel.trim())) ||
    positions.length < 1 ||
    positions.length > 20 ||
    !positions.every(
      (value) =>
        Number.isInteger(value) &&
        (value as number) >= 1 &&
        (value as number) <= 20
    ) ||
    new Set(positions).size !== positions.length
  ) {
    return null;
  }
  return {
    commandId,
    method: paymentMethod,
    payerLabel,
    positions: positions as number[],
    splitId,
    tipCents
  };
}

export function parsePaySharesResult(input: unknown): PaySharesResult | null {
  const root = record(input);
  if (
    !root ||
    !hasExactKeys(root, [
      "amountCents",
      "paymentCents",
      "paymentId",
      "pendingCents",
      "positions",
      "sessionId",
      "shiftId",
      "split",
      "splitId",
      "tipCents"
    ]) ||
    !Array.isArray(root.positions)
  ) {
    return null;
  }
  const { positions, split, splitId, ...rest } = root;
  const payment = parsePaymentResult(rest);
  const parsedSplit = split === null ? null : parseAccountSplit(split);
  const id = uuid(splitId);
  if (
    !payment ||
    !id ||
    (split !== null && !parsedSplit) ||
    !(positions as unknown[]).every(
      (value) => Number.isInteger(value) && (value as number) >= 1
    )
  ) {
    return null;
  }
  return {
    ...payment,
    positions: positions as number[],
    split: parsedSplit,
    splitId: id
  };
}

export type CreateItemSplitRequest = {
  assignments: { lineId: string; position: number }[];
  commandId: string;
  persons: number;
};

export function parseCreateItemSplitRequest(
  input: unknown
): CreateItemSplitRequest | null {
  const root = record(input);
  if (
    !root ||
    !hasExactKeys(root, ["assignments", "commandId", "persons"]) ||
    !Array.isArray(root.assignments) ||
    root.assignments.length > 200
  ) {
    return null;
  }
  const commandId = uuid(root.commandId);
  const persons = integer(root.persons);
  if (!commandId || persons === null || persons < 2 || persons > 20) {
    return null;
  }
  const assignments: { lineId: string; position: number }[] = [];
  const seen = new Set<string>();
  for (const candidate of root.assignments) {
    const entry = record(candidate);
    if (!entry || !hasExactKeys(entry, ["lineId", "position"])) return null;
    const lineId = uuid(entry.lineId);
    const position = integer(entry.position);
    if (
      !lineId ||
      position === null ||
      position < 1 ||
      position > persons ||
      seen.has(lineId)
    ) {
      return null;
    }
    seen.add(lineId);
    assignments.push({ lineId, position });
  }
  return { assignments, commandId, persons };
}
