import {
  parseDinerWaiterCallRequest,
  parseDinerWaiterCallResult,
  parseTenantScope,
  type DinerWaiterCallRequest,
  type DinerWaiterCallResult,
  type TenantScope
} from "@platform/contracts";
import type { Sql } from "postgres";

export type CreateWaiterCallInput = {
  request: DinerWaiterCallRequest;
  scope: TenantScope;
};

export interface WaiterCallRepository {
  create(input: CreateWaiterCallInput): Promise<DinerWaiterCallResult>;
}

type ResultRow = { result: unknown };

export function createWaiterCallRepository(client: Sql): WaiterCallRepository {
  return {
    async create(input) {
      const scope = parseTenantScope(input.scope);
      if (!scope) throw new Error("tenant scope must be canonical");
      const request = parseDinerWaiterCallRequest(input.request);
      if (!request) throw new Error("waiter call request must be canonical");
      const [row] = await client<ResultRow[]>`
        select private.create_waiter_call(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${request.token},
          ${request.reason}
        ) as result
      `;
      const result = parseDinerWaiterCallResult(row?.result);
      if (!result) throw new Error("waiter call result must be canonical");
      return result;
    }
  };
}
