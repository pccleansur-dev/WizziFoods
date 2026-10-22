import {
  assertMatchingTenantScope,
  parseTenantJobEnvelope,
  type TenantJobEnvelope,
  type TenantScope
} from "@platform/contracts";

export function authorizeTenantJob(
  expectedScope: TenantScope,
  value: unknown
): TenantJobEnvelope {
  const envelope = parseTenantJobEnvelope(value);
  if (!envelope) throw new Error("invalid tenant job envelope");

  assertMatchingTenantScope(expectedScope, envelope.scope);
  return envelope;
}
