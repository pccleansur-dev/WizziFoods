import {
  parseProductionAdvanceRequest,
  parseProductionAdvanceResult,
  parseProductionBoard,
  parseTenantScope,
  type ProductionAdvanceRequest,
  type ProductionAdvanceResult,
  type ProductionBoard,
  type TenantScope
} from "@platform/contracts";
import type { Sql } from "postgres";

type StaffScope = { scope: TenantScope; staffId: string };

export interface ProductionRepository {
  advanceItem(
    input: StaffScope & {
      lineId: string;
      orderId: string;
      request: ProductionAdvanceRequest;
    }
  ): Promise<ProductionAdvanceResult>;
  getBoard(input: StaffScope): Promise<ProductionBoard>;
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
function normalizeBoard(value: unknown, generatedAt: string): unknown {
  const root = record(value);
  if (
    !root ||
    !Array.isArray(root.tickets) ||
    Object.keys(root).sort().join() !== "sector,tickets"
  ) {
    return null;
  }
  return {
    ...root,
    generatedAt,
    tickets: root.tickets.map((entry) => {
      const row = record(entry);
      return row
        ? { ...row, confirmedAt: isoTimestamp(row.confirmedAt) }
        : entry;
    })
  };
}

export function createProductionRepository(client: Sql): ProductionRepository {
  return {
    async getBoard(input) {
      const scope = assertScope(input.scope);
      const [row] = await client<ResultRow[]>`
        select private.production_board(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${input.staffId}::uuid
        ) as result
      `;
      const board = parseProductionBoard(
        normalizeBoard(row?.result, new Date().toISOString())
      );
      if (!board) throw new Error("production board must be canonical");
      return board;
    },

    async advanceItem(input) {
      const scope = assertScope(input.scope);
      const request = parseProductionAdvanceRequest(input.request);
      if (!request) throw new Error("production request must be canonical");
      const [row] = await client<ResultRow[]>`
        select private.advance_production_item(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${input.staffId}::uuid,
          ${request.commandId}::uuid,
          ${input.orderId}::uuid,
          ${input.lineId}::uuid,
          ${request.status}
        ) as result
      `;
      const result = parseProductionAdvanceResult(row?.result);
      if (!result) throw new Error("production result must be canonical");
      return result;
    }
  };
}
