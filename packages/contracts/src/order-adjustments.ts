import type {
  ProductionItemStatus,
  ProductionOrderStatus
} from "./production.js";

/** None of these requests carries a tenant, location, role, price or total. */
export type DeliverItemRequest = { commandId: string };
export type ProductionExceptionRequest = { commandId: string; reason: string };
export type ReplacementProposalRequest = {
  commandId: string;
  productId: string;
  variantId: string | null;
};
export type ReplacementDecisionRequest =
  | { commandId: string; decision: "accept"; reason: null }
  | { commandId: string; decision: "reject"; reason: string };
export type CancelItemRequest = { commandId: string; reason: string };

export type ItemStateResult = {
  changed: boolean;
  lineId: string;
  orderId: string;
  orderStatus: ProductionOrderStatus;
  status: ProductionItemStatus;
};

export type ReplacementProposalResult = {
  adjustmentId: string;
  differenceCents: number;
  lineId: string;
  orderId: string;
  originalTotalCents: number;
  replacementTitle: string;
  replacementTotalCents: number;
  replacementVariantTitle: string | null;
  status: "proposed";
};

export type ReplacementDecisionResult = {
  adjustmentId: string;
  orderStatus: ProductionOrderStatus;
  replacementLineId: string | null;
  status: "accepted" | "rejected";
};

export type CancelItemResult = {
  adjustmentId: string;
  differenceCents: number;
  lineId: string;
  orderId: string;
  orderStatus: ProductionOrderStatus;
  status: "cancelled";
};

export type WaiterOrderAdjustment = {
  differenceCents: number;
  id: string;
  kind: "cancellation" | "replacement";
  replacementTitle: string | null;
  status: "accepted" | "proposed" | "rejected";
};

export type WaiterInProgressItem = {
  adjustment: WaiterOrderAdjustment | null;
  exceptionReason: string | null;
  lineId: string;
  quantity: number;
  sector: "bar" | "kitchen" | "other";
  status: ProductionItemStatus;
  title: string;
  totalCents: number;
  unitPriceCents: number;
  variantTitle: string | null;
};

export type WaiterOrderInProgress = {
  /** Accepted differences (replacements and cancellations) on this order. */
  adjustmentCents: number;
  attribution: "individual" | "table";
  confirmedAt: string;
  dinerName: string | null;
  items: WaiterInProgressItem[];
  orderId: string;
  seatLabel: string | null;
  status: ProductionOrderStatus;
  tableId: string;
  tableLabel: string;
  totalCents: number;
};

export type WaiterOrdersView = {
  generatedAt: string;
  orders: WaiterOrderInProgress[];
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

function reason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= 200 ? trimmed : null;
}

function bounded(value: unknown, maximumLength: number): string | null {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumLength
    ? value
    : null;
}

function nullableBounded(
  value: unknown,
  maximumLength: number
): string | null | undefined {
  if (value === null) return null;
  return bounded(value, maximumLength) ?? undefined;
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : null;
}

function cents(value: unknown): number | null {
  const parsed = integer(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
}

function timestamp(value: unknown): string | null {
  return typeof value === "string" &&
    !Number.isNaN(new Date(value).getTime()) &&
    new Date(value).toISOString() === value
    ? value
    : null;
}

const itemStatuses: readonly ProductionItemStatus[] = [
  "queued",
  "preparing",
  "ready",
  "delivered",
  "exception",
  "cancelled",
  "replaced"
];
const orderStatuses: readonly ProductionOrderStatus[] = [
  "queued",
  "in_preparation",
  "ready",
  "delivered",
  "exception",
  "cancelled"
];

function itemStatus(value: unknown): ProductionItemStatus | null {
  return itemStatuses.find((status) => status === value) ?? null;
}

function orderStatus(value: unknown): ProductionOrderStatus | null {
  return orderStatuses.find((status) => status === value) ?? null;
}

export function parseDeliverItemRequest(
  input: unknown
): DeliverItemRequest | null {
  const candidate = record(input);
  if (!candidate || !hasExactKeys(candidate, ["commandId"])) return null;
  const commandId = uuid(candidate.commandId);
  return commandId ? { commandId } : null;
}

function parseReasonRequest(
  input: unknown
): { commandId: string; reason: string } | null {
  const candidate = record(input);
  if (!candidate || !hasExactKeys(candidate, ["commandId", "reason"])) {
    return null;
  }
  const commandId = uuid(candidate.commandId);
  const text = reason(candidate.reason);
  return commandId && text ? { commandId, reason: text } : null;
}

export function parseProductionExceptionRequest(
  input: unknown
): ProductionExceptionRequest | null {
  return parseReasonRequest(input);
}

export function parseCancelItemRequest(
  input: unknown
): CancelItemRequest | null {
  return parseReasonRequest(input);
}

export function parseReplacementProposalRequest(
  input: unknown
): ReplacementProposalRequest | null {
  const candidate = record(input);
  if (
    !candidate ||
    !hasExactKeys(candidate, ["commandId", "productId", "variantId"])
  ) {
    return null;
  }
  const commandId = uuid(candidate.commandId);
  const productId = uuid(candidate.productId);
  const variantId =
    candidate.variantId === null ? null : uuid(candidate.variantId);
  if (
    !commandId ||
    !productId ||
    (candidate.variantId !== null && !variantId)
  ) {
    return null;
  }
  return { commandId, productId, variantId };
}

export function parseReplacementDecisionRequest(
  input: unknown
): ReplacementDecisionRequest | null {
  const candidate = record(input);
  if (
    !candidate ||
    !hasExactKeys(candidate, ["commandId", "decision", "reason"])
  ) {
    return null;
  }
  const commandId = uuid(candidate.commandId);
  if (!commandId) return null;
  if (candidate.decision === "accept") {
    return candidate.reason === null
      ? { commandId, decision: "accept", reason: null }
      : null;
  }
  if (candidate.decision === "reject") {
    const text = reason(candidate.reason);
    return text ? { commandId, decision: "reject", reason: text } : null;
  }
  return null;
}

export function parseItemStateResult(input: unknown): ItemStateResult | null {
  const root = record(input);
  if (
    !root ||
    !hasExactKeys(root, [
      "changed",
      "lineId",
      "orderId",
      "orderStatus",
      "status"
    ]) ||
    typeof root.changed !== "boolean"
  ) {
    return null;
  }
  const lineId = uuid(root.lineId);
  const orderId = uuid(root.orderId);
  const status = itemStatus(root.status);
  const derived = orderStatus(root.orderStatus);
  if (!lineId || !orderId || !status || status === "queued" || !derived) {
    return null;
  }
  return {
    changed: root.changed,
    lineId,
    orderId,
    orderStatus: derived,
    status
  };
}

export function parseReplacementProposalResult(
  input: unknown
): ReplacementProposalResult | null {
  const root = record(input);
  if (
    !root ||
    !hasExactKeys(root, [
      "adjustmentId",
      "differenceCents",
      "lineId",
      "orderId",
      "originalTotalCents",
      "replacementTitle",
      "replacementTotalCents",
      "replacementVariantTitle",
      "status"
    ]) ||
    root.status !== "proposed"
  ) {
    return null;
  }
  const adjustmentId = uuid(root.adjustmentId);
  const lineId = uuid(root.lineId);
  const orderId = uuid(root.orderId);
  const original = cents(root.originalTotalCents);
  const replacement = cents(root.replacementTotalCents);
  const difference = integer(root.differenceCents);
  const title = bounded(root.replacementTitle, 160);
  const variantTitle = nullableBounded(root.replacementVariantTitle, 160);
  if (
    !adjustmentId ||
    !lineId ||
    !orderId ||
    original === null ||
    replacement === null ||
    difference === null ||
    !title ||
    variantTitle === undefined ||
    difference !== replacement - original
  ) {
    return null;
  }
  return {
    adjustmentId,
    differenceCents: difference,
    lineId,
    orderId,
    originalTotalCents: original,
    replacementTitle: title,
    replacementTotalCents: replacement,
    replacementVariantTitle: variantTitle,
    status: "proposed"
  };
}

export function parseReplacementDecisionResult(
  input: unknown
): ReplacementDecisionResult | null {
  const root = record(input);
  if (
    !root ||
    !hasExactKeys(root, [
      "adjustmentId",
      "orderStatus",
      "replacementLineId",
      "status"
    ]) ||
    (root.status !== "accepted" && root.status !== "rejected")
  ) {
    return null;
  }
  const adjustmentId = uuid(root.adjustmentId);
  const derived = orderStatus(root.orderStatus);
  const replacementLineId =
    root.replacementLineId === null ? null : uuid(root.replacementLineId);
  if (
    !adjustmentId ||
    !derived ||
    // Only an accepted replacement creates a new line.
    (root.status === "accepted") !== (replacementLineId !== null)
  ) {
    return null;
  }
  return {
    adjustmentId,
    orderStatus: derived,
    replacementLineId,
    status: root.status
  };
}

export function parseCancelItemResult(input: unknown): CancelItemResult | null {
  const root = record(input);
  if (
    !root ||
    !hasExactKeys(root, [
      "adjustmentId",
      "differenceCents",
      "lineId",
      "orderId",
      "orderStatus",
      "status"
    ]) ||
    root.status !== "cancelled"
  ) {
    return null;
  }
  const adjustmentId = uuid(root.adjustmentId);
  const lineId = uuid(root.lineId);
  const orderId = uuid(root.orderId);
  const difference = integer(root.differenceCents);
  const derived = orderStatus(root.orderStatus);
  if (
    !adjustmentId ||
    !lineId ||
    !orderId ||
    difference === null ||
    difference > 0 ||
    !derived
  ) {
    return null;
  }
  return {
    adjustmentId,
    differenceCents: difference,
    lineId,
    orderId,
    orderStatus: derived,
    status: "cancelled"
  };
}

function orderAdjustment(
  input: unknown
): WaiterOrderAdjustment | null | undefined {
  if (input === null) return null;
  const root = record(input);
  if (
    !root ||
    !hasExactKeys(root, [
      "differenceCents",
      "id",
      "kind",
      "replacementTitle",
      "status"
    ]) ||
    (root.kind !== "replacement" && root.kind !== "cancellation") ||
    (root.status !== "proposed" &&
      root.status !== "accepted" &&
      root.status !== "rejected")
  ) {
    return undefined;
  }
  const id = uuid(root.id);
  const difference = integer(root.differenceCents);
  const title = nullableBounded(root.replacementTitle, 330);
  if (!id || difference === null || title === undefined) return undefined;
  return {
    differenceCents: difference,
    id,
    kind: root.kind,
    replacementTitle: title,
    status: root.status
  };
}

function waiterItem(input: unknown): WaiterInProgressItem | null {
  const root = record(input);
  if (
    !root ||
    !hasExactKeys(root, [
      "adjustment",
      "exceptionReason",
      "lineId",
      "quantity",
      "sector",
      "status",
      "title",
      "totalCents",
      "unitPriceCents",
      "variantTitle"
    ]) ||
    (root.sector !== "kitchen" &&
      root.sector !== "bar" &&
      root.sector !== "other")
  ) {
    return null;
  }
  const adjustment = orderAdjustment(root.adjustment);
  const exceptionReason = nullableBounded(root.exceptionReason, 200);
  const lineId = uuid(root.lineId);
  const status = itemStatus(root.status);
  const title = bounded(root.title, 160);
  const variantTitle = nullableBounded(root.variantTitle, 160);
  const quantity = integer(root.quantity);
  const total = cents(root.totalCents);
  const unit = cents(root.unitPriceCents);
  if (
    adjustment === undefined ||
    exceptionReason === undefined ||
    !lineId ||
    !status ||
    !title ||
    variantTitle === undefined ||
    quantity === null ||
    quantity < 1 ||
    quantity > 20 ||
    total === null ||
    unit === null
  ) {
    return null;
  }
  return {
    adjustment,
    exceptionReason,
    lineId,
    quantity,
    sector: root.sector,
    status,
    title,
    totalCents: total,
    unitPriceCents: unit,
    variantTitle
  };
}

function waiterOrder(input: unknown): WaiterOrderInProgress | null {
  const root = record(input);
  if (
    !root ||
    !hasExactKeys(root, [
      "adjustmentCents",
      "attribution",
      "confirmedAt",
      "dinerName",
      "items",
      "orderId",
      "seatLabel",
      "status",
      "tableId",
      "tableLabel",
      "totalCents"
    ]) ||
    (root.attribution !== "table" && root.attribution !== "individual") ||
    !Array.isArray(root.items) ||
    root.items.length < 1 ||
    root.items.length > 100
  ) {
    return null;
  }
  const items: WaiterInProgressItem[] = [];
  for (const entry of root.items) {
    const parsed = waiterItem(entry);
    if (!parsed) return null;
    items.push(parsed);
  }
  const adjustment = integer(root.adjustmentCents);
  const confirmedAt = timestamp(root.confirmedAt);
  const dinerName = nullableBounded(root.dinerName, 80);
  const seatLabel = nullableBounded(root.seatLabel, 40);
  const orderId = uuid(root.orderId);
  const status = orderStatus(root.status);
  const tableId = uuid(root.tableId);
  const tableLabel = bounded(root.tableLabel, 80);
  const total = cents(root.totalCents);
  if (
    adjustment === null ||
    !confirmedAt ||
    dinerName === undefined ||
    seatLabel === undefined ||
    !orderId ||
    !status ||
    !tableId ||
    !tableLabel ||
    total === null
  ) {
    return null;
  }
  return {
    adjustmentCents: adjustment,
    attribution: root.attribution,
    confirmedAt,
    dinerName,
    items,
    orderId,
    seatLabel,
    status,
    tableId,
    tableLabel,
    totalCents: total
  };
}

export function parseWaiterOrdersView(input: unknown): WaiterOrdersView | null {
  const root = record(input);
  if (
    !root ||
    !hasExactKeys(root, ["generatedAt", "orders"]) ||
    !Array.isArray(root.orders) ||
    root.orders.length > 200
  ) {
    return null;
  }
  const generatedAt = timestamp(root.generatedAt);
  if (!generatedAt) return null;
  const orders: WaiterOrderInProgress[] = [];
  for (const entry of root.orders) {
    const parsed = waiterOrder(entry);
    if (!parsed) return null;
    orders.push(parsed);
  }
  return { generatedAt, orders };
}
