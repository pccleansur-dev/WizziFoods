import type { TenantScope } from "@platform/contracts";
import { describe, expect, it } from "vitest";

import { authorizeTenantJob } from "./tenant-job.js";

const expectedScope: TenantScope = {
  locationId: "92000000-0000-4000-8000-000000000092",
  tenantId: "91000000-0000-4000-8000-000000000091"
};

describe("authorizeTenantJob", () => {
  it("accepts a valid envelope for the claimed queue scope", () => {
    expect(
      authorizeTenantJob(expectedScope, {
        jobId: "95000000-0000-4000-8000-000000000095",
        kind: "menu.import",
        payload: { source: "photo" },
        scope: expectedScope
      })
    ).toMatchObject({ kind: "menu.import", scope: expectedScope });
  });

  it("rejects malformed and cross-tenant envelopes", () => {
    expect(() =>
      authorizeTenantJob(expectedScope, {
        jobId: "95000000-0000-4000-8000-000000000095",
        kind: "menu.import",
        payload: {},
        scope: expectedScope,
        tenant_id: "93000000-0000-4000-8000-000000000093"
      })
    ).toThrow("invalid tenant job envelope");
    expect(() =>
      authorizeTenantJob(expectedScope, {
        jobId: "95000000-0000-4000-8000-000000000095",
        kind: "menu.import",
        payload: {},
        scope: {
          ...expectedScope,
          tenantId: "93000000-0000-4000-8000-000000000093"
        }
      })
    ).toThrow("tenant scope mismatch");
  });
});
