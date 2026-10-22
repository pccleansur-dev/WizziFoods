export type TenantScope = Readonly<{
  locationId: string;
  tenantId: string;
}>;

export type TenantJobEnvelope<TPayload = unknown> = Readonly<{
  jobId: string;
  kind: string;
  payload: TPayload;
  scope: TenantScope;
}>;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const jobKindPattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u;
const realtimeTopicPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: string[]
): boolean {
  return Object.keys(value).sort().join("\0") === expected.sort().join("\0");
}

export function parseTenantScope(value: unknown): TenantScope | null {
  const candidate = record(value);
  if (
    !candidate ||
    !hasExactKeys(candidate, ["locationId", "tenantId"]) ||
    typeof candidate.locationId !== "string" ||
    typeof candidate.tenantId !== "string" ||
    !uuidPattern.test(candidate.locationId) ||
    !uuidPattern.test(candidate.tenantId)
  ) {
    return null;
  }

  return {
    locationId: candidate.locationId,
    tenantId: candidate.tenantId
  };
}

export function assertMatchingTenantScope(
  expected: TenantScope,
  candidate: TenantScope
): void {
  const trusted = parseTenantScope(expected);
  const received = parseTenantScope(candidate);
  if (
    !trusted ||
    !received ||
    trusted.tenantId !== received.tenantId ||
    trusted.locationId !== received.locationId
  ) {
    throw new Error("tenant scope mismatch");
  }
}

export function parseTenantJobEnvelope(
  value: unknown
): TenantJobEnvelope | null {
  const candidate = record(value);
  if (
    !candidate ||
    !hasExactKeys(candidate, ["jobId", "kind", "payload", "scope"]) ||
    typeof candidate.jobId !== "string" ||
    typeof candidate.kind !== "string" ||
    !uuidPattern.test(candidate.jobId) ||
    candidate.kind.length > 80 ||
    !jobKindPattern.test(candidate.kind)
  ) {
    return null;
  }

  const scope = parseTenantScope(candidate.scope);
  return scope
    ? {
        jobId: candidate.jobId,
        kind: candidate.kind,
        payload: candidate.payload,
        scope
      }
    : null;
}

export function tenantStoragePrefix(scope: TenantScope): string {
  const canonical = parseTenantScope(scope);
  if (!canonical) throw new Error("tenant scope must be canonical");
  return `tenants/${canonical.tenantId}/locations/${canonical.locationId}`;
}

export function tenantRealtimeChannel(
  scope: TenantScope,
  topic: string
): string {
  const canonical = parseTenantScope(scope);
  if (!canonical) throw new Error("tenant scope must be canonical");
  if (topic.length > 64 || !realtimeTopicPattern.test(topic)) {
    throw new Error("realtime topic must be canonical");
  }
  return `tenant:${canonical.tenantId}:location:${canonical.locationId}:${topic}`;
}
