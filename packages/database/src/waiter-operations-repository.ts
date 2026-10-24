import {
  parseManualOrderRequest,
  parseTenantScope,
  parseWaiterCallClaimRequest,
  parseWaiterCallClaimResult,
  parseWaiterIntentDecisionRequest,
  parseWaiterIntentDecisionResult,
  parseWaiterOrderResult,
  parseWaiterSalonView,
  type TenantScope,
  type WaiterCallClaimRequest,
  type WaiterCallClaimResult,
  type WaiterIntentDecisionRequest,
  type WaiterIntentDecisionResult,
  type WaiterManualOrderRequest,
  type WaiterOrderResult,
  type WaiterSalonView
} from "@platform/contracts";
import type { Sql } from "postgres";

type StaffScope = { scope: TenantScope; staffId: string };

export interface WaiterOperationsRepository {
  claimCall(
    input: StaffScope & { callId: string; request: WaiterCallClaimRequest }
  ): Promise<WaiterCallClaimResult>;
  createManualOrder(
    input: StaffScope & { request: WaiterManualOrderRequest }
  ): Promise<WaiterOrderResult>;
  decideIntent(
    input: StaffScope & {
      intentId: string;
      request: WaiterIntentDecisionRequest;
    }
  ): Promise<WaiterIntentDecisionResult>;
  getSalon(input: StaffScope): Promise<WaiterSalonView>;
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
function normalizeSalon(value: unknown, generatedAt: string): unknown {
  const root = record(value);
  if (
    !root ||
    !Array.isArray(root.calls) ||
    !Array.isArray(root.intents) ||
    Object.keys(root).sort().join() !== "calls,floors,intents,units"
  ) {
    return null;
  }
  const withIso = (entries: unknown[]) =>
    entries.map((entry) => {
      const row = record(entry);
      return row ? { ...row, createdAt: isoTimestamp(row.createdAt) } : entry;
    });
  return {
    ...root,
    calls: withIso(root.calls),
    generatedAt,
    intents: withIso(root.intents)
  };
}

export function createWaiterOperationsRepository(
  client: Sql
): WaiterOperationsRepository {
  return {
    async getSalon(input) {
      const scope = assertScope(input.scope);
      const [row] = await client<ResultRow[]>`
        select private.waiter_salon_view(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${input.staffId}::uuid
        ) as result
      `;
      const view = parseWaiterSalonView(
        normalizeSalon(row?.result, new Date().toISOString())
      );
      if (!view) throw new Error("salon view must be canonical");
      return view;
    },

    async claimCall(input) {
      const scope = assertScope(input.scope);
      const request = parseWaiterCallClaimRequest(input.request);
      if (!request) throw new Error("waiter request must be canonical");
      const [row] = await client<ResultRow[]>`
        select private.claim_waiter_call(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${input.staffId}::uuid,
          ${input.callId}::uuid,
          ${request.commandId}::uuid
        ) as result
      `;
      const result = parseWaiterCallClaimResult(row?.result);
      if (!result) throw new Error("call claim result must be canonical");
      return result;
    },

    async decideIntent(input) {
      const scope = assertScope(input.scope);
      const request = parseWaiterIntentDecisionRequest(input.request);
      if (!request) throw new Error("waiter request must be canonical");
      const [row] = await client<ResultRow[]>`
        select private.decide_order_intent(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${input.staffId}::uuid,
          ${input.intentId}::uuid,
          ${request.commandId}::uuid,
          ${request.decision},
          ${request.reason}
        ) as result
      `;
      const result = parseWaiterIntentDecisionResult(row?.result);
      if (!result) throw new Error("order result must be canonical");
      return result;
    },

    async createManualOrder(input) {
      const scope = assertScope(input.scope);
      const request = parseManualOrderRequest(input.request);
      if (!request) throw new Error("waiter request must be canonical");
      const [row] = await client<ResultRow[]>`
        select private.create_manual_order(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${input.staffId}::uuid,
          ${request.commandId}::uuid,
          ${request.tableId}::uuid,
          ${request.attribution},
          ${request.dinerName},
          ${request.seatLabel},
          ${JSON.stringify(request.items)}::jsonb
        ) as result
      `;
      const result = parseWaiterOrderResult(row?.result);
      if (!result) throw new Error("order result must be canonical");
      return result;
    }
  };
}
