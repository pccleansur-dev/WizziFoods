import { describe, expect, it } from "vitest";

import { parseProvisionedTenant } from "./tenant-provisioning-state";

describe("tenant provisioning response", () => {
  it("accepts only the public invitation result", () => {
    expect(
      parseProvisionedTenant({
        data: {
          adminEmail: "owner@example.com",
          authUserId: "must-not-be-used",
          status: "invited",
          tenant: { name: "Café Norte", slug: "cafe-norte" }
        }
      })
    ).toEqual({
      adminEmail: "owner@example.com",
      status: "invited",
      tenant: { name: "Café Norte", slug: "cafe-norte" }
    });
  });

  it("rejects malformed API responses", () => {
    expect(
      parseProvisionedTenant({ data: { status: "pending_invitation" } })
    ).toBeNull();
  });
});
