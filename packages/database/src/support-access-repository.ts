import type { Sql } from "postgres";

export type SupportAccessStatus = "active" | "expired" | "revoked";

export type SupportAccessGrant = {
  expiresAt: string;
  grantedAt: string;
  id: string;
  reason: string;
  revokedAt: string | null;
  status: SupportAccessStatus;
  supportUserId: string;
};

export type GrantSupportAccessInput = {
  correlationId: string;
  durationMinutes: number;
  grantedBy: string;
  reason: string;
  supportUserId: string;
  tenantId: string;
};

export type RevokeSupportAccessInput = {
  correlationId: string;
  grantId: string;
  reason: string;
  revokedBy: string;
  tenantId: string;
};

export interface SupportAccessRepository {
  grant(input: GrantSupportAccessInput): Promise<SupportAccessGrant>;
  list(tenantId: string, requesterId: string): Promise<SupportAccessGrant[]>;
  resolveActive(
    tenantId: string,
    supportUserId: string
  ): Promise<{ expiresAt: string; grantId: string } | null>;
  revoke(input: RevokeSupportAccessInput): Promise<SupportAccessGrant>;
}

type SupportAccessRow = {
  expires_at: Date | string;
  granted_at: Date | string;
  id: string;
  reason: string;
  revoked_at: Date | string | null;
  status: SupportAccessStatus;
  support_user_id: string;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const correlationPattern = /^[A-Za-z0-9._:-]{1,128}$/u;

function assertUuid(value: string, label: string): void {
  if (!uuidPattern.test(value)) throw new Error(`${label} must be a UUID`);
}

function normalizeReason(reason: string): string {
  const normalized = reason.trim();
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

/** El cliente comparte el driver de drizzle, que entrega los timestamps como texto. */
function toIsoTimestamp(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    throw new Error("database timestamp must be valid");
  }
  return parsed.toISOString();
}

function mapRow(row: SupportAccessRow): SupportAccessGrant {
  return {
    expiresAt: toIsoTimestamp(row.expires_at),
    grantedAt: toIsoTimestamp(row.granted_at),
    id: row.id,
    reason: row.reason,
    revokedAt: row.revoked_at ? toIsoTimestamp(row.revoked_at) : null,
    status: row.status,
    supportUserId: row.support_user_id
  };
}

export function createSupportAccessRepository(
  client: Sql
): SupportAccessRepository {
  return {
    async grant(untrustedInput) {
      assertUuid(untrustedInput.tenantId, "tenantId");
      assertUuid(untrustedInput.supportUserId, "supportUserId");
      assertUuid(untrustedInput.grantedBy, "grantedBy");
      assertCorrelation(untrustedInput.correlationId);
      if (
        !Number.isInteger(untrustedInput.durationMinutes) ||
        untrustedInput.durationMinutes < 15 ||
        untrustedInput.durationMinutes > 240
      ) {
        throw new Error("durationMinutes must be between 15 and 240");
      }
      const reason = normalizeReason(untrustedInput.reason);
      const [row] = await client<SupportAccessRow[]>`
        select *
        from private.grant_support_access(
          ${untrustedInput.tenantId}::uuid,
          ${untrustedInput.supportUserId}::uuid,
          ${untrustedInput.grantedBy}::uuid,
          ${reason},
          ${untrustedInput.durationMinutes},
          ${untrustedInput.correlationId}
        )
      `;
      if (!row) throw new Error("Support grant did not return a record");
      return mapRow(row);
    },

    async list(tenantId, requesterId) {
      assertUuid(tenantId, "tenantId");
      assertUuid(requesterId, "requesterId");
      const rows = await client<SupportAccessRow[]>`
        select *
        from private.list_support_access(
          ${tenantId}::uuid,
          ${requesterId}::uuid
        )
      `;
      return rows.map(mapRow);
    },

    async resolveActive(tenantId, supportUserId) {
      assertUuid(tenantId, "tenantId");
      assertUuid(supportUserId, "supportUserId");
      const [row] = await client<
        { expires_at: Date | string; grant_id: string }[]
      >`
        select *
        from private.resolve_active_support_access(
          ${tenantId}::uuid,
          ${supportUserId}::uuid
        )
      `;
      return row
        ? { expiresAt: toIsoTimestamp(row.expires_at), grantId: row.grant_id }
        : null;
    },

    async revoke(untrustedInput) {
      assertUuid(untrustedInput.tenantId, "tenantId");
      assertUuid(untrustedInput.grantId, "grantId");
      assertUuid(untrustedInput.revokedBy, "revokedBy");
      assertCorrelation(untrustedInput.correlationId);
      const reason = normalizeReason(untrustedInput.reason);
      const [row] = await client<SupportAccessRow[]>`
        select *
        from private.revoke_support_access(
          ${untrustedInput.tenantId}::uuid,
          ${untrustedInput.grantId}::uuid,
          ${untrustedInput.revokedBy}::uuid,
          ${reason},
          ${untrustedInput.correlationId}
        )
      `;
      if (!row) throw new Error("Support revocation did not return a record");
      return mapRow(row);
    }
  };
}
