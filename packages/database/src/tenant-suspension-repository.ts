import type { TenantSuspensionMode } from "@platform/contracts";
import type { Sql } from "postgres";

export type TenantSuspensionRecord = {
  completedAt: string | null;
  mode: TenantSuspensionMode;
  phase: "commercial_draining" | "suspended";
  requestedAt: string;
  tenantStatus: "active" | "suspended";
};

export type RequestTenantSuspensionInput = {
  actorUserId: string;
  correlationId: string;
  mode: TenantSuspensionMode;
  reason: string;
  tenantId: string;
};

export interface TenantSuspensionRepository {
  request(input: RequestTenantSuspensionInput): Promise<TenantSuspensionRecord>;
}

type TenantSuspensionRow = {
  completed_at: Date | null;
  mode: TenantSuspensionMode;
  phase: "commercial_draining" | "suspended";
  requested_at: Date;
  tenant_status: "active" | "suspended";
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const correlationPattern = /^[A-Za-z0-9._:-]{1,128}$/u;

function assertUuid(value: string, label: string): void {
  if (!uuidPattern.test(value)) throw new Error(`${label} must be a UUID`);
}

function normalizeReason(reason: string): string {
  const normalized = reason.trim().normalize("NFKC");
  if (normalized.length < 3 || normalized.length > 500) {
    throw new Error("reason must contain between 3 and 500 characters");
  }
  return normalized;
}

function assertCorrelation(value: string): void {
  if (!correlationPattern.test(value)) {
    throw new Error("correlationId must be safe");
  }
}

function mapRow(row: TenantSuspensionRow): TenantSuspensionRecord {
  return {
    completedAt: row.completed_at?.toISOString() ?? null,
    mode: row.mode,
    phase: row.phase,
    requestedAt: row.requested_at.toISOString(),
    tenantStatus: row.tenant_status
  };
}

export function createTenantSuspensionRepository(
  client: Sql
): TenantSuspensionRepository {
  return {
    async request(untrustedInput) {
      assertUuid(untrustedInput.tenantId, "tenantId");
      assertUuid(untrustedInput.actorUserId, "actorUserId");
      assertCorrelation(untrustedInput.correlationId);
      const reason = normalizeReason(untrustedInput.reason);

      const [row] = await client<TenantSuspensionRow[]>`
        select *
        from private.request_tenant_suspension(
          ${untrustedInput.tenantId}::uuid,
          ${untrustedInput.actorUserId}::uuid,
          ${untrustedInput.mode},
          ${reason},
          ${untrustedInput.correlationId}
        )
      `;
      if (!row) throw new Error("Tenant suspension did not return a record");
      return mapRow(row);
    }
  };
}
