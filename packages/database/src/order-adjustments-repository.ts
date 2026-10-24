import {
  parseCancelItemRequest,
  parseCancelItemResult,
  parseDeliverItemRequest,
  parseItemStateResult,
  parseProductionExceptionRequest,
  parseReplacementDecisionRequest,
  parseReplacementDecisionResult,
  parseReplacementProposalRequest,
  parseReplacementProposalResult,
  parseTenantScope,
  parseWaiterOrdersView,
  type CancelItemRequest,
  type CancelItemResult,
  type DeliverItemRequest,
  type ItemStateResult,
  type ProductionExceptionRequest,
  type ReplacementDecisionRequest,
  type ReplacementDecisionResult,
  type ReplacementProposalRequest,
  type ReplacementProposalResult,
  type TenantScope,
  type WaiterOrdersView
} from "@platform/contracts";
import type { Sql } from "postgres";

type StaffScope = { scope: TenantScope; staffId: string };
type ItemTarget = StaffScope & { lineId: string; orderId: string };

export interface OrderAdjustmentsRepository {
  cancelItem(
    input: ItemTarget & { request: CancelItemRequest }
  ): Promise<CancelItemResult>;
  decideReplacement(
    input: StaffScope & {
      adjustmentId: string;
      request: ReplacementDecisionRequest;
    }
  ): Promise<ReplacementDecisionResult>;
  deliverItem(
    input: ItemTarget & { request: DeliverItemRequest }
  ): Promise<ItemStateResult>;
  getOrders(input: StaffScope): Promise<WaiterOrdersView>;
  proposeReplacement(
    input: ItemTarget & { request: ReplacementProposalRequest }
  ): Promise<ReplacementProposalResult>;
  reportException(
    input: ItemTarget & { request: ProductionExceptionRequest }
  ): Promise<ItemStateResult>;
}

type ResultRow = { result: unknown };

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

function isoTimestamp(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

/** PostgreSQL renders timestamps with its own offset format; the contract is ISO. */
function normalizeOrders(value: unknown, generatedAt: string): unknown {
  const root = record(value);
  if (
    !root ||
    !Array.isArray(root.orders) ||
    Object.keys(root).sort().join() !== "orders"
  ) {
    return null;
  }
  return {
    generatedAt,
    orders: root.orders.map((entry) => {
      const row = record(entry);
      return row
        ? { ...row, confirmedAt: isoTimestamp(row.confirmedAt) }
        : entry;
    })
  };
}

export function createOrderAdjustmentsRepository(
  client: Sql
): OrderAdjustmentsRepository {
  return {
    async getOrders(input) {
      const scope = assertScope(input.scope);
      const [row] = await client<ResultRow[]>`
        select private.waiter_orders_view(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${input.staffId}::uuid
        ) as result
      `;
      const view = parseWaiterOrdersView(
        normalizeOrders(row?.result, new Date().toISOString())
      );
      if (!view) throw new Error("waiter orders view must be canonical");
      return view;
    },

    async deliverItem(input) {
      const scope = assertScope(input.scope);
      const request = parseDeliverItemRequest(input.request);
      if (!request) throw new Error("delivery request must be canonical");
      const [row] = await client<ResultRow[]>`
        select private.deliver_order_item(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${input.staffId}::uuid,
          ${request.commandId}::uuid,
          ${input.orderId}::uuid,
          ${input.lineId}::uuid
        ) as result
      `;
      const result = parseItemStateResult(row?.result);
      if (!result) throw new Error("item state result must be canonical");
      return result;
    },

    async reportException(input) {
      const scope = assertScope(input.scope);
      const request = parseProductionExceptionRequest(input.request);
      if (!request) throw new Error("exception request must be canonical");
      const [row] = await client<ResultRow[]>`
        select private.report_production_exception(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${input.staffId}::uuid,
          ${request.commandId}::uuid,
          ${input.orderId}::uuid,
          ${input.lineId}::uuid,
          ${request.reason}
        ) as result
      `;
      const result = parseItemStateResult(row?.result);
      if (!result) throw new Error("item state result must be canonical");
      return result;
    },

    async proposeReplacement(input) {
      const scope = assertScope(input.scope);
      const request = parseReplacementProposalRequest(input.request);
      if (!request) throw new Error("replacement request must be canonical");
      const [row] = await client<ResultRow[]>`
        select private.propose_item_replacement(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${input.staffId}::uuid,
          ${request.commandId}::uuid,
          ${input.orderId}::uuid,
          ${input.lineId}::uuid,
          ${request.productId}::uuid,
          ${request.variantId}::uuid
        ) as result
      `;
      const result = parseReplacementProposalResult(row?.result);
      if (!result) throw new Error("replacement proposal must be canonical");
      return result;
    },

    async decideReplacement(input) {
      const scope = assertScope(input.scope);
      const request = parseReplacementDecisionRequest(input.request);
      if (!request) throw new Error("replacement decision must be canonical");
      const [row] = await client<ResultRow[]>`
        select private.decide_item_replacement(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${input.staffId}::uuid,
          ${request.commandId}::uuid,
          ${input.adjustmentId}::uuid,
          ${request.decision},
          ${request.reason}
        ) as result
      `;
      const result = parseReplacementDecisionResult(row?.result);
      if (!result) throw new Error("replacement result must be canonical");
      return result;
    },

    async cancelItem(input) {
      const scope = assertScope(input.scope);
      const request = parseCancelItemRequest(input.request);
      if (!request) throw new Error("cancellation request must be canonical");
      const [row] = await client<ResultRow[]>`
        select private.cancel_order_item(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${input.staffId}::uuid,
          ${request.commandId}::uuid,
          ${input.orderId}::uuid,
          ${input.lineId}::uuid,
          ${request.reason}
        ) as result
      `;
      const result = parseCancelItemResult(row?.result);
      if (!result) throw new Error("cancellation result must be canonical");
      return result;
    }
  };
}
