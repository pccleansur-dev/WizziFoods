import { readWebConfig } from "@platform/config";

import { createAuthServerClient } from "../../auth/supabase-server";

export type PlatformTenantSummary = {
  id: string;
  name: string;
  primaryHostname: string | null;
  slug: string;
  status: "active" | "draft" | "suspended";
  suspension: {
    mode: "commercial" | "security";
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

export type PlatformOperations = {
  auditEvents: PlatformAuditEvent[];
  tenants: PlatformTenantSummary[];
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function isRecord(input: unknown): input is Record<string, unknown> {
  return Boolean(input) && typeof input === "object" && !Array.isArray(input);
}

function isIsoDate(input: unknown): input is string {
  return typeof input === "string" && !Number.isNaN(Date.parse(input));
}

function parseTenant(input: unknown): PlatformTenantSummary | null {
  if (!isRecord(input)) return null;
  const { id, name, primaryHostname, slug, status, suspension } = input;
  if (
    typeof id !== "string" ||
    !uuidPattern.test(id) ||
    typeof name !== "string" ||
    typeof slug !== "string" ||
    (primaryHostname !== null && typeof primaryHostname !== "string") ||
    (status !== "active" && status !== "draft" && status !== "suspended")
  ) {
    return null;
  }

  let parsedSuspension: PlatformTenantSummary["suspension"] = null;
  if (suspension !== null) {
    if (
      !isRecord(suspension) ||
      (suspension.mode !== "commercial" && suspension.mode !== "security") ||
      (suspension.phase !== "commercial_draining" &&
        suspension.phase !== "suspended") ||
      !isIsoDate(suspension.requestedAt)
    ) {
      return null;
    }
    parsedSuspension = {
      mode: suspension.mode,
      phase: suspension.phase,
      requestedAt: suspension.requestedAt
    };
  }

  return {
    id,
    name,
    primaryHostname,
    slug,
    status,
    suspension: parsedSuspension
  };
}

function parseAuditEvent(input: unknown): PlatformAuditEvent | null {
  if (!isRecord(input)) return null;
  const requiredStrings = [
    "action",
    "actorId",
    "actorType",
    "correlationId",
    "id",
    "reason",
    "tenantId",
    "tenantName"
  ] as const;
  if (
    requiredStrings.some((key) => typeof input[key] !== "string") ||
    !uuidPattern.test(String(input.actorId)) ||
    !uuidPattern.test(String(input.tenantId)) ||
    !isIsoDate(input.occurredAt)
  ) {
    return null;
  }
  return input as PlatformAuditEvent;
}

export function parsePlatformOperationsResponse(
  input: unknown
): PlatformOperations | null {
  if (!isRecord(input) || !isRecord(input.data)) return null;
  const { auditEvents, tenants } = input.data;
  if (!Array.isArray(auditEvents) || !Array.isArray(tenants)) return null;

  const parsedTenants = tenants.map(parseTenant);
  const parsedAuditEvents = auditEvents.map(parseAuditEvent);
  if (
    parsedTenants.some((tenant) => !tenant) ||
    parsedAuditEvents.some((event) => !event)
  ) {
    return null;
  }
  return {
    auditEvents: parsedAuditEvents as PlatformAuditEvent[],
    tenants: parsedTenants as PlatformTenantSummary[]
  };
}

export async function loadPlatformOperations(): Promise<
  { data: PlatformOperations; status: "ready" } | { status: "unavailable" }
> {
  const supabase = await createAuthServerClient();
  const session = await supabase.auth.getSession();
  const accessToken = session.data.session?.access_token;
  if (session.error || !accessToken) return { status: "unavailable" };

  try {
    const config = readWebConfig(process.env);
    const response = await fetch(`${config.apiUrl}/v1/platform/operations`, {
      cache: "no-store",
      headers: { authorization: `Bearer ${accessToken}` }
    });
    if (!response.ok) return { status: "unavailable" };
    const parsed = parsePlatformOperationsResponse(await response.json());
    return parsed
      ? { data: parsed, status: "ready" }
      : { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}
