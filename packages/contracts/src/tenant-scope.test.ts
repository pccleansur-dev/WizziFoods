import { describe, expect, it } from "vitest";

import {
  assertMatchingTenantScope,
  parseTenantJobEnvelope,
  parseTenantScope,
  tenantRealtimeChannel,
  tenantStoragePrefix
} from "./tenant-scope.js";

const scope = {
  locationId: "92000000-0000-4000-8000-000000000092",
  tenantId: "91000000-0000-4000-8000-000000000091"
};

describe("tenant execution scope", () => {
  it("accepts only an exact UUID tenant and location pair", () => {
    expect(parseTenantScope(scope)).toEqual(scope);
    expect(
      parseTenantScope({ ...scope, tenant_id: scope.tenantId })
    ).toBeNull();
    expect(parseTenantScope({ locationId: scope.locationId })).toBeNull();
    expect(parseTenantScope({ ...scope, tenantId: "from-client" })).toBeNull();
  });

  it("rejects a different tenant or location at a trusted boundary", () => {
    expect(() => assertMatchingTenantScope(scope, scope)).not.toThrow();
    expect(() =>
      assertMatchingTenantScope(scope, {
        ...scope,
        tenantId: "93000000-0000-4000-8000-000000000093"
      })
    ).toThrow("tenant scope mismatch");
    expect(() =>
      assertMatchingTenantScope(scope, {
        ...scope,
        locationId: "94000000-0000-4000-8000-000000000094"
      })
    ).toThrow("tenant scope mismatch");
  });

  it("parses a scoped job without trusting an extra tenant_id", () => {
    expect(
      parseTenantJobEnvelope({
        jobId: "95000000-0000-4000-8000-000000000095",
        kind: "menu.import",
        payload: { source: "photo" },
        scope
      })
    ).toEqual({
      jobId: "95000000-0000-4000-8000-000000000095",
      kind: "menu.import",
      payload: { source: "photo" },
      scope
    });
    expect(
      parseTenantJobEnvelope({
        jobId: "95000000-0000-4000-8000-000000000095",
        kind: "menu.import",
        payload: {},
        scope,
        tenant_id: "93000000-0000-4000-8000-000000000093"
      })
    ).toBeNull();
  });

  it("derives Storage and Realtime namespaces from the same scope", () => {
    expect(tenantStoragePrefix(scope)).toBe(
      `tenants/${scope.tenantId}/locations/${scope.locationId}`
    );
    expect(tenantRealtimeChannel(scope, "table-session")).toBe(
      `tenant:${scope.tenantId}:location:${scope.locationId}:table-session`
    );
    expect(() => tenantRealtimeChannel(scope, "../other-tenant")).toThrow(
      "realtime topic must be canonical"
    );
  });
});
