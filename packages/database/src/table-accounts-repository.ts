import {
  parseApplyDiscountRequest,
  parseDiscountResult,
  parseKeepOpenRequest,
  parseKeepOpenResult,
  parsePaymentResult,
  parseRecordPaymentRequest,
  parseTenantScope,
  parseWaiterAccountsView,
  type ApplyDiscountRequest,
  type DiscountResult,
  type KeepOpenRequest,
  type KeepOpenResult,
  type PaymentResult,
  type RecordPaymentRequest,
  type TenantScope,
  type WaiterAccountsView
} from "@platform/contracts";
import type { Sql } from "postgres";

type StaffScope = { scope: TenantScope; staffId: string };
type SessionTarget = StaffScope & { sessionId: string };

export interface TableAccountsRepository {
  applyDiscount(
    input: SessionTarget & { request: ApplyDiscountRequest }
  ): Promise<DiscountResult>;
  getAccounts(input: StaffScope): Promise<WaiterAccountsView>;
  keepOpen(
    input: SessionTarget & { request: KeepOpenRequest }
  ): Promise<KeepOpenResult>;
  recordPayment(
    input: SessionTarget & { request: RecordPaymentRequest }
  ): Promise<PaymentResult>;
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
function normalizeAccounts(value: unknown, generatedAt: string): unknown {
  const root = record(value);
  if (
    !root ||
    !Array.isArray(root.accounts) ||
    typeof root.cashRegisterOpen !== "boolean" ||
    Object.keys(root).sort().join() !== "accounts,cashRegisterOpen"
  ) {
    return null;
  }
  return {
    accounts: root.accounts.map((entry) => {
      const account = record(entry);
      if (!account) return entry;
      return {
        ...account,
        entries: Array.isArray(account.entries)
          ? account.entries.map((movement) => {
              const row = record(movement);
              return row
                ? { ...row, createdAt: isoTimestamp(row.createdAt) }
                : movement;
            })
          : account.entries,
        openedAt: isoTimestamp(account.openedAt)
      };
    }),
    cashRegisterOpen: root.cashRegisterOpen,
    generatedAt
  };
}

export function createTableAccountsRepository(
  client: Sql
): TableAccountsRepository {
  return {
    async getAccounts(input) {
      const scope = assertScope(input.scope);
      const [row] = await client<ResultRow[]>`
        select private.waiter_accounts_view(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${input.staffId}::uuid
        ) as result
      `;
      const view = parseWaiterAccountsView(
        normalizeAccounts(row?.result, new Date().toISOString())
      );
      if (!view) throw new Error("accounts view must be canonical");
      return view;
    },

    async recordPayment(input) {
      const scope = assertScope(input.scope);
      const request = parseRecordPaymentRequest(input.request);
      if (!request) throw new Error("payment request must be canonical");
      const [row] = await client<ResultRow[]>`
        select private.record_account_payment(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${input.staffId}::uuid,
          ${request.commandId}::uuid,
          ${input.sessionId}::uuid,
          ${request.method},
          ${request.amountCents}::integer,
          ${request.tipCents}::integer
        ) as result
      `;
      const result = parsePaymentResult(row?.result);
      if (!result) throw new Error("payment result must be canonical");
      return result;
    },

    async applyDiscount(input) {
      const scope = assertScope(input.scope);
      const request = parseApplyDiscountRequest(input.request);
      if (!request) throw new Error("discount request must be canonical");
      const [row] = await client<ResultRow[]>`
        select private.apply_account_discount(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${input.staffId}::uuid,
          ${request.commandId}::uuid,
          ${input.sessionId}::uuid,
          ${request.kind},
          ${request.value}::integer,
          ${request.reason}
        ) as result
      `;
      const result = parseDiscountResult(row?.result);
      if (!result) throw new Error("discount result must be canonical");
      return result;
    },

    async keepOpen(input) {
      const scope = assertScope(input.scope);
      const request = parseKeepOpenRequest(input.request);
      if (!request) throw new Error("keep-open request must be canonical");
      const [row] = await client<ResultRow[]>`
        select private.keep_account_open(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${input.staffId}::uuid,
          ${request.commandId}::uuid,
          ${input.sessionId}::uuid
        ) as result
      `;
      const result = parseKeepOpenResult(row?.result);
      if (!result) throw new Error("keep-open result must be canonical");
      return result;
    }
  };
}
