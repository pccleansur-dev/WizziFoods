import type { TenantSuspensionMode } from "@platform/contracts";
import type { Sql } from "postgres";

export type TenantSuspensionRecord = {
  completedAt: string | null;
  mode: TenantSuspensionMode;
  phase: "commercial_draining" | "suspended";
  requestedAt: string;
  tenantStatus: "active" | "suspended";
};

export type PlatformTenantSummary = {
  id: string;
  name: string;
  primaryHostname: string | null;
  slug: string;
  status: "active" | "draft" | "suspended";
  suspension: {
    mode: TenantSuspensionMode;
    phase: "commercial_draining" | "suspended";
    requestedAt: string;
  } | null;
};

export type PlatformAuditEvent = {
  action: string;
  actorId: string;
  actorType: string;
  correlationId: string;
  id: string;
  occurredAt: string;
  reason: string;
  tenantId: string;
  tenantName: string;
};

export type RequestTenantSuspensionInput = {
  actorUserId: string;
  correlationId: string;
  mode: TenantSuspensionMode;
  reason: string;
  tenantId: string;
};

export interface TenantSuspensionRepository {
  listAuditEvents(
    requesterId: string,
    limit: number
  ): Promise<PlatformAuditEvent[]>;
  listTenants(requesterId: string): Promise<PlatformTenantSummary[]>;
  request(input: RequestTenantSuspensionInput): Promise<TenantSuspensionRecord>;
}

type PlatformTenantRow = {
  name: string;
  primary_hostname: string | null;
  slug: string;
  status: "active" | "draft" | "suspended";
  suspension_mode: TenantSuspensionMode | null;
  suspension_phase: "commercial_draining" | "suspended" | null;
  suspension_requested_at: Date | null;
  tenant_id: string;
};

type PlatformAuditEventRow = {
  action: string;
  actor_id: string;
  actor_type: string;
  correlation_id: string;
  event_id: string;
  occurred_at: Date;
  reason: string;
  tenant_id: string;
  tenant_name: string;
};

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
    async listAuditEvents(requesterId, limit) {
      assertUuid(requesterId, "requesterId");
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new Error("limit must be between 1 and 100");
      }
      const rows = await client<PlatformAuditEventRow[]>`
        select *
        from private.list_platform_audit_events(
          ${requesterId}::uuid,
          ${limit}
        )
      `;
      return rows.map((row) => ({
        action: row.action,
        actorId: row.actor_id,
        actorType: row.actor_type,
        correlationId: row.correlation_id,
        id: String(row.event_id),
        occurredAt: row.occurred_at.toISOString(),
        reason: row.reason,
        tenantId: row.tenant_id,
        tenantName: row.tenant_name
      }));
    },

    async listTenants(requesterId) {
      assertUuid(requesterId, "requesterId");
      const rows = await client<PlatformTenantRow[]>`
        select *
        from private.list_platform_tenants(${requesterId}::uuid)
      `;
      return rows.map((row) => ({
        id: row.tenant_id,
        name: row.name,
        primaryHostname: row.primary_hostname,
        slug: row.slug,
        status: row.status,
        suspension:
          row.suspension_mode &&
          row.suspension_phase &&
          row.suspension_requested_at
            ? {
                mode: row.suspension_mode,
                phase: row.suspension_phase,
                requestedAt: row.suspension_requested_at.toISOString()
              }
            : null
      }));
    },

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
