import {
  parseCashMovementRequest,
  parseCashMovementResult,
  parseCashRegisterView,
  parseCloseShiftRequest,
  parseCloseShiftResult,
  parseOpenShiftRequest,
  parseOpenShiftResult,
  parseRefundRequest,
  parseRefundResult,
  parseTenantScope,
  type CashMovementRequest,
  type CashMovementResult,
  type CashRegisterView,
  type CloseShiftRequest,
  type CloseShiftResult,
  type OpenShiftRequest,
  type OpenShiftResult,
  type RefundRequest,
  type RefundResult,
  type TenantScope
} from "@platform/contracts";
import type { Sql } from "postgres";

type StaffScope = { scope: TenantScope; staffId: string };

export interface CashRegisterRepository {
  closeShift(
    input: StaffScope & { request: CloseShiftRequest }
  ): Promise<CloseShiftResult>;
  getRegister(input: StaffScope): Promise<CashRegisterView>;
  openShift(
    input: StaffScope & { request: OpenShiftRequest }
  ): Promise<OpenShiftResult>;
  recordMovement(
    input: StaffScope & { request: CashMovementRequest }
  ): Promise<CashMovementResult>;
  recordRefund(
    input: StaffScope & { request: RefundRequest; sessionId: string }
  ): Promise<RefundResult>;
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

function withIso(value: unknown, keys: string[]): unknown {
  const row = record(value);
  if (!row) return value;
  const next: Record<string, unknown> = { ...row };
  for (const key of keys) next[key] = isoTimestamp(row[key]);
  return next;
}

/** PostgreSQL renders timestamps with its own offset format; the contract is ISO. */
function normalizeRegister(value: unknown, generatedAt: string): unknown {
  const root = record(value);
  if (!root || !Array.isArray(root.closures)) return null;
  const register = record(root.register);
  return {
    ...root,
    closures: root.closures.map((closure) =>
      withIso(closure, ["closedAt", "openedAt"])
    ),
    generatedAt,
    register:
      register && register.open === true
        ? {
            ...register,
            movements: Array.isArray(register.movements)
              ? register.movements.map((movement) =>
                  withIso(movement, ["createdAt"])
                )
              : register.movements,
            openedAt: isoTimestamp(register.openedAt)
          }
        : root.register
  };
}

export function createCashRegisterRepository(
  client: Sql
): CashRegisterRepository {
  return {
    async getRegister(input) {
      const scope = assertScope(input.scope);
      const [row] = await client<ResultRow[]>`
        select private.cash_register_view(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${input.staffId}::uuid
        ) as result
      `;
      const view = parseCashRegisterView(
        normalizeRegister(row?.result, new Date().toISOString())
      );
      if (!view) throw new Error("register view must be canonical");
      return view;
    },

    async openShift(input) {
      const scope = assertScope(input.scope);
      const request = parseOpenShiftRequest(input.request);
      if (!request) throw new Error("opening request must be canonical");
      const [row] = await client<ResultRow[]>`
        select private.open_cash_shift(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${input.staffId}::uuid,
          ${request.commandId}::uuid,
          ${request.openingCashCents}::integer
        ) as result
      `;
      const result = parseOpenShiftResult(withIso(row?.result, ["openedAt"]));
      if (!result) throw new Error("opening result must be canonical");
      return result;
    },

    async recordMovement(input) {
      const scope = assertScope(input.scope);
      const request = parseCashMovementRequest(input.request);
      if (!request) throw new Error("movement request must be canonical");
      const [row] = await client<ResultRow[]>`
        select private.record_cash_movement(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${input.staffId}::uuid,
          ${request.commandId}::uuid,
          ${request.kind},
          ${request.amountCents}::integer,
          ${request.reason}
        ) as result
      `;
      const result = parseCashMovementResult(row?.result);
      if (!result) throw new Error("movement result must be canonical");
      return result;
    },

    async closeShift(input) {
      const scope = assertScope(input.scope);
      const request = parseCloseShiftRequest(input.request);
      if (!request) throw new Error("closing request must be canonical");
      const [row] = await client<ResultRow[]>`
        select private.close_cash_shift(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${input.staffId}::uuid,
          ${request.commandId}::uuid,
          ${request.countedCashCents}::integer,
          ${request.reason}
        ) as result
      `;
      const result = parseCloseShiftResult(row?.result);
      if (!result) throw new Error("closing result must be canonical");
      return result;
    },

    async recordRefund(input) {
      const scope = assertScope(input.scope);
      const request = parseRefundRequest(input.request);
      if (!request) throw new Error("refund request must be canonical");
      const [row] = await client<ResultRow[]>`
        select private.record_account_refund(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${input.staffId}::uuid,
          ${request.commandId}::uuid,
          ${input.sessionId}::uuid,
          ${request.paymentId}::uuid,
          ${request.amountCents}::integer,
          ${request.itemLineId}::uuid,
          ${request.reason}
        ) as result
      `;
      const result = parseRefundResult(row?.result);
      if (!result) throw new Error("refund result must be canonical");
      return result;
    }
  };
}
