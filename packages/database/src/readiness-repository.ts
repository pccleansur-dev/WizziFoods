import {
  parseReadinessReport,
  parseSandboxRun,
  parseTenantScope,
  type ReadinessReport,
  type SandboxRun,
  type TenantScope
} from "@platform/contracts";
import type { Sql } from "postgres";

/**
 * Requisitos mínimos, publicación del negocio y modo prueba (T15). La base
 * evalúa y revalida; este repositorio sólo valida alcance y forma.
 */
export interface ReadinessRepository {
  cleanupSandbox(scope: TenantScope, requesterId: string): Promise<number>;
  get(scope: TenantScope, requesterId: string): Promise<ReadinessReport>;
  publish(scope: TenantScope, requesterId: string): Promise<ReadinessReport>;
  runSandbox(scope: TenantScope, requesterId: string): Promise<SandboxRun>;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function assertScope(scope: TenantScope): TenantScope {
  const parsed = parseTenantScope(scope);
  if (!parsed) throw new Error("tenant scope must be canonical");
  return parsed;
}

function assertRequester(requesterId: string): void {
  if (!uuidPattern.test(requesterId)) {
    throw new Error("requesterId must be a UUID");
  }
}

function report(value: unknown): ReadinessReport {
  const parsed = parseReadinessReport(value);
  if (!parsed) throw new Error("readiness report must be canonical");
  return parsed;
}

type ResultRow = { result: unknown };

export function createReadinessRepository(client: Sql): ReadinessRepository {
  return {
    async cleanupSandbox(untrustedScope, requesterId) {
      const scope = assertScope(untrustedScope);
      assertRequester(requesterId);
      const [row] = await client<{ removed: number }[]>`
        select private.cleanup_sandbox(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${requesterId}::uuid
        ) as removed
      `;
      return row?.removed ?? 0;
    },

    async get(untrustedScope, requesterId) {
      const scope = assertScope(untrustedScope);
      assertRequester(requesterId);
      const [row] = await client<ResultRow[]>`
        select private.get_location_readiness(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${requesterId}::uuid
        ) as result
      `;
      return report(row?.result);
    },

    async publish(untrustedScope, requesterId) {
      const scope = assertScope(untrustedScope);
      assertRequester(requesterId);
      const [row] = await client<ResultRow[]>`
        select private.publish_location(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${requesterId}::uuid
        ) as result
      `;
      return report(row?.result);
    },

    async runSandbox(untrustedScope, requesterId) {
      const scope = assertScope(untrustedScope);
      assertRequester(requesterId);
      const [row] = await client<ResultRow[]>`
        select private.run_sandbox_simulation(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${requesterId}::uuid
        ) as result
      `;
      const run = parseSandboxRun(row?.result);
      if (!run) throw new Error("sandbox run must be canonical");
      return run;
    }
  };
}
