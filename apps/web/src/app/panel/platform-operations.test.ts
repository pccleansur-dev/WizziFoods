import { describe, expect, it } from "vitest";

import { parsePlatformOperationsResponse } from "./platform-operations";

describe("parsePlatformOperationsResponse", () => {
  it("accepts the bounded platform operations payload", () => {
    expect(
      parsePlatformOperationsResponse({
        data: {
          auditEvents: [
            {
              action: "tenant.suspension_requested",
              actorId: "71000000-0000-4000-8000-000000000071",
              actorType: "platform_superadmin",
              correlationId: "suspension-001",
              id: "1",
              occurredAt: "2026-10-22T15:30:00.000Z",
              reason: "Subscription period ended",
              tenantId: "74000000-0000-4000-8000-000000000074",
              tenantName: "Café Norte"
            }
          ],
          tenants: [
            {
              id: "74000000-0000-4000-8000-000000000074",
              name: "Café Norte",
              primaryHostname: "cafe-norte.plataforma.test",
              slug: "cafe-norte",
              status: "active",
              suspension: null
            }
          ]
        }
      })
    ).toMatchObject({ tenants: [{ name: "Café Norte" }] });
  });

  it.each([
    null,
    {},
    { data: { auditEvents: [], tenants: "all" } },
    {
      data: {
        auditEvents: [],
        tenants: [{ id: "not-a-uuid", name: "Bad", status: "active" }]
      }
    }
  ])("rejects malformed API data", (input) => {
    expect(parsePlatformOperationsResponse(input)).toBeNull();
  });
});
