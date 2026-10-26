import {
  parseAccountReceipt,
  parseCashierRequestResult,
  parseCleanTableResult,
  parseCloseAccountResult,
  parseClosedAccountsView,
  parseResolveCashierRequestResult,
  parseTableClosingCommand,
  parseTenantScope,
  type AccountReceipt,
  type CashierRequestResult,
  type CleanTableResult,
  type CloseAccountResult,
  type ClosedAccountsView,
  type ResolveCashierRequestResult,
  type TableClosingCommand,
  type TenantScope
} from "@platform/contracts";
import type { Sql } from "postgres";

type StaffScope = { scope: TenantScope; staffId: string };
type SessionTarget = StaffScope & { sessionId: string };

export interface TableClosingRepository {
  cleanTable(
    input: StaffScope & { request: TableClosingCommand; tableId: string }
  ): Promise<CleanTableResult>;
  closeAccount(
    input: SessionTarget & { request: TableClosingCommand }
  ): Promise<CloseAccountResult>;
  getClosedAccounts(input: StaffScope): Promise<ClosedAccountsView>;
  getReceipt(input: SessionTarget): Promise<AccountReceipt>;
  requestCashier(
    input: SessionTarget & { request: TableClosingCommand }
  ): Promise<CashierRequestResult>;
  resolveCashierRequest(
    input: StaffScope & { request: TableClosingCommand; requestId: string }
  ): Promise<ResolveCashierRequestResult>;
}

type ResultRow = { result: unknown };

const timestampKeys = new Set(["closedAt", "openedAt"]);

function assertScope(value: TenantScope): TenantScope {
  const parsed = parseTenantScope(value);
  if (!parsed) throw new Error("tenant scope must be canonical");
  return parsed;
}

function assertCommand(value: TableClosingCommand): TableClosingCommand {
  const parsed = parseTableClosingCommand(value);
  if (!parsed) throw new Error("table closing request must be canonical");
  return parsed;
}

/** PostgreSQL renders timestamps with its own offset format; the contract is ISO. */
function normalizeTimestamps(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeTimestamps);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      if (timestampKeys.has(key) && typeof entry === "string") {
        const parsed = new Date(entry);
        return [
          key,
          Number.isNaN(parsed.getTime()) ? entry : parsed.toISOString()
        ];
      }
      return [key, normalizeTimestamps(entry)];
    })
  );
}

export function createTableClosingRepository(
  client: Sql
): TableClosingRepository {
  return {
    async closeAccount(input) {
      const scope = assertScope(input.scope);
      const request = assertCommand(input.request);
      const [row] = await client<ResultRow[]>`
        select private.close_table_session(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${input.staffId}::uuid,
          ${request.commandId}::uuid,
          ${input.sessionId}::uuid
        ) as result
      `;
      const result = parseCloseAccountResult(normalizeTimestamps(row?.result));
      if (!result) throw new Error("close result must be canonical");
      return result;
    },

    async cleanTable(input) {
      const scope = assertScope(input.scope);
      const request = assertCommand(input.request);
      const [row] = await client<ResultRow[]>`
        select private.mark_table_clean(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${input.staffId}::uuid,
          ${request.commandId}::uuid,
          ${input.tableId}::uuid
        ) as result
      `;
      const result = parseCleanTableResult(row?.result);
      if (!result) throw new Error("clean result must be canonical");
      return result;
    },

    async getReceipt(input) {
      const scope = assertScope(input.scope);
      const [row] = await client<ResultRow[]>`
        select private.account_receipt(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${input.staffId}::uuid,
          ${input.sessionId}::uuid
        ) as result
      `;
      const receipt = parseAccountReceipt(normalizeTimestamps(row?.result));
      if (!receipt) throw new Error("receipt must be canonical");
      return receipt;
    },

    async requestCashier(input) {
      const scope = assertScope(input.scope);
      const request = assertCommand(input.request);
      const [row] = await client<ResultRow[]>`
        select private.request_cashier(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${input.staffId}::uuid,
          ${request.commandId}::uuid,
          ${input.sessionId}::uuid
        ) as result
      `;
      const result = parseCashierRequestResult(row?.result);
      if (!result) throw new Error("cashier request result must be canonical");
      return result;
    },

    async resolveCashierRequest(input) {
      const scope = assertScope(input.scope);
      const request = assertCommand(input.request);
      const [row] = await client<ResultRow[]>`
        select private.resolve_cashier_request(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${input.staffId}::uuid,
          ${request.commandId}::uuid,
          ${input.requestId}::uuid
        ) as result
      `;
      const result = parseResolveCashierRequestResult(row?.result);
      if (!result) throw new Error("resolve result must be canonical");
      return result;
    },

    async getClosedAccounts(input) {
      const scope = assertScope(input.scope);
      const [row] = await client<ResultRow[]>`
        select private.closed_accounts_view(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${input.staffId}::uuid
        ) as result
      `;
      const root =
        typeof row?.result === "object" && row.result !== null
          ? (row.result as Record<string, unknown>)
          : null;
      const view = parseClosedAccountsView(
        root
          ? normalizeTimestamps({
              ...root,
              generatedAt: new Date().toISOString()
            })
          : null
      );
      if (!view) throw new Error("closed accounts view must be canonical");
      return view;
    }
  };
}
