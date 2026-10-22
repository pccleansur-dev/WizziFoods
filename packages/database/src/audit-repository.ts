import type { Sql } from "postgres";

export type AuditActorType =
  "platform_superadmin" | "staff" | "support" | "tenant_admin";

export type AppendAuditEventInput = {
  action: string;
  actorId: string;
  actorType: AuditActorType;
  correlationId: string;
  reason: string;
  subjectId?: string;
  subjectType?: string;
  tenantId: string;
};

export interface AuditRepository {
  append(input: AppendAuditEventInput): Promise<string>;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const actionPattern = /^[a-z][a-z0-9_.]{2,79}$/u;
const correlationPattern = /^[A-Za-z0-9._:-]{1,128}$/u;
const subjectTypePattern = /^[a-z][a-z0-9_]{1,49}$/u;

function assertUuid(value: string, label: string): void {
  if (!uuidPattern.test(value)) throw new Error(`${label} must be a UUID`);
}

function validate(input: AppendAuditEventInput): AppendAuditEventInput {
  assertUuid(input.tenantId, "tenantId");
  assertUuid(input.actorId, "actorId");
  if (!actionPattern.test(input.action)) {
    throw new Error("action must be a canonical audit action");
  }
  if (!correlationPattern.test(input.correlationId)) {
    throw new Error("correlationId must be safe");
  }

  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 500) {
    throw new Error("reason must contain between 3 and 500 characters");
  }

  if ((input.subjectType === undefined) !== (input.subjectId === undefined)) {
    throw new Error("subjectType and subjectId must be provided together");
  }
  if (input.subjectType && !subjectTypePattern.test(input.subjectType)) {
    throw new Error("subjectType must be canonical");
  }
  if (input.subjectId) assertUuid(input.subjectId, "subjectId");

  return { ...input, reason };
}

export function createAuditRepository(client: Sql): AuditRepository {
  return {
    async append(untrustedInput) {
      const input = validate(untrustedInput);
      const [row] = await client<{ event_id: string }[]>`
        select private.append_audit_event(
          ${input.tenantId}::uuid,
          ${input.actorType},
          ${input.actorId}::uuid,
          ${input.action},
          ${input.reason},
          ${input.correlationId},
          ${input.subjectType ?? null},
          ${input.subjectId ?? null}::uuid
        )::text as event_id
      `;
      if (!row) throw new Error("Audit append did not return an event id");
      return row.event_id;
    }
  };
}
