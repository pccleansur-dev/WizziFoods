import {
  parseJoinTablesCommand,
  parseJoinTablesResult,
  parseSeparateTablesCommand,
  parseSeparateTablesResult,
  parseTenantScope,
  type JoinTablesCommand,
  type JoinTablesResult,
  type SeparateTablesCommand,
  type SeparateTablesResult,
  type TenantScope
} from "@platform/contracts";
import type { Sql } from "postgres";

type StaffScope = { scope: TenantScope; staffId: string };

export interface TableRegroupingRepository {
  joinTables(
    input: StaffScope & { request: JoinTablesCommand }
  ): Promise<JoinTablesResult>;
  separateTables(
    input: StaffScope & { groupId: string; request: SeparateTablesCommand }
  ): Promise<SeparateTablesResult>;
}

type ResultRow = { result: unknown };

function assertScope(value: TenantScope): TenantScope {
  const parsed = parseTenantScope(value);
  if (!parsed) throw new Error("tenant scope must be canonical");
  return parsed;
}

export function createTableRegroupingRepository(
  client: Sql
): TableRegroupingRepository {
  return {
    async joinTables(input) {
      const scope = assertScope(input.scope);
      const request = parseJoinTablesCommand(input.request);
      if (!request) throw new Error("join request must be canonical");
      // The SQL stores the request in canonical order, so a retry with the same
      // tables in another order is the same command.
      const tableIds = [...request.tableIds].sort();
      const [row] = await client<ResultRow[]>`
        select private.join_tables(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${input.staffId}::uuid,
          ${request.commandId}::uuid,
          ${tableIds}::uuid[],
          ${request.name}::text
        ) as result
      `;
      const result = parseJoinTablesResult(row?.result);
      if (!result) throw new Error("join result must be canonical");
      return result;
    },

    async separateTables(input) {
      const scope = assertScope(input.scope);
      const request = parseSeparateTablesCommand(input.request);
      if (!request) throw new Error("separate request must be canonical");
      const [row] = await client<ResultRow[]>`
        select private.separate_tables(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${input.staffId}::uuid,
          ${request.commandId}::uuid,
          ${input.groupId}::uuid,
          ${request.anchorTableId}::uuid
        ) as result
      `;
      const result = parseSeparateTablesResult(row?.result);
      if (!result) throw new Error("separate result must be canonical");
      return result;
    }
  };
}
