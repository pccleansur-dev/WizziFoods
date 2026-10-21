import { describe, expect, it } from "vitest";

import { parseAdministrativeAccess } from "./admin-access";

describe("parseAdministrativeAccess", () => {
  it("accepts a platform superadmin response", () => {
    expect(
      parseAdministrativeAccess({
        data: {
          access: { type: "platform_superadmin" },
          identity: {
            assuranceLevel: "aal2",
            userId: "10000000-0000-4000-8000-000000000001"
          }
        }
      })
    ).toMatchObject({ access: { type: "platform_superadmin" } });
  });

  it("accepts an assigned tenant administrator response", () => {
    expect(
      parseAdministrativeAccess({
        data: {
          access: {
            tenantContexts: [
              {
                location: { id: "location-1", name: "Principal" },
                role: "admin",
                tenant: {
                  id: "tenant-1",
                  name: "Bodegón del Centro",
                  slug: "bodegon-del-centro",
                  status: "draft"
                }
              }
            ],
            type: "tenant_admin"
          },
          identity: {
            assuranceLevel: "aal2",
            userId: "10000000-0000-4000-8000-000000000001"
          }
        }
      })
    ).toMatchObject({
      access: {
        tenantContexts: [
          { tenant: { name: "Bodegón del Centro", status: "draft" } }
        ],
        type: "tenant_admin"
      }
    });
  });

  it("rejects a malformed or downgraded response", () => {
    expect(
      parseAdministrativeAccess({
        data: {
          access: { type: "platform_superadmin" },
          identity: { assuranceLevel: "aal1", userId: "not-a-uuid" }
        }
      })
    ).toBeNull();
  });
});
