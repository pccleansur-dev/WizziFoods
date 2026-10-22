import { describe, expect, it } from "vitest";

import {
  evaluateTenantSuspension,
  settleCommercialSuspension
} from "./tenant-suspension.js";

describe("evaluateTenantSuspension", () => {
  it("drains a commercial suspension while table sessions remain open", () => {
    expect(
      evaluateTenantSuspension({
        mode: "commercial",
        activeTableSessions: 3
      })
    ).toEqual({
      state: { phase: "commercial_draining" },
      tenantStatus: "active",
      allowNewTableSessions: false,
      terminateActiveSessions: false
    });
  });

  it("completes a commercial suspension when there are no open table sessions", () => {
    expect(
      evaluateTenantSuspension({
        mode: "commercial",
        activeTableSessions: 0
      })
    ).toEqual({
      state: { phase: "suspended", mode: "commercial" },
      tenantStatus: "suspended",
      allowNewTableSessions: false,
      terminateActiveSessions: false
    });
  });

  it("immediately suspends for security even while table sessions are open", () => {
    expect(
      evaluateTenantSuspension({
        mode: "security",
        activeTableSessions: 4
      })
    ).toEqual({
      state: { phase: "suspended", mode: "security" },
      tenantStatus: "suspended",
      allowNewTableSessions: false,
      terminateActiveSessions: true
    });
  });

  it.each([-1, 1.5, Number.NaN])(
    "rejects an invalid active table session count: %s",
    (activeTableSessions) => {
      expect(() =>
        evaluateTenantSuspension({
          mode: "commercial",
          activeTableSessions
        })
      ).toThrow("activeTableSessions must be a non-negative integer");
    }
  );
});

describe("settleCommercialSuspension", () => {
  it("keeps draining until the final table session closes", () => {
    expect(
      settleCommercialSuspension({ phase: "commercial_draining" }, 1)
    ).toEqual({ phase: "commercial_draining" });
  });

  it("completes when the final table session closes", () => {
    expect(
      settleCommercialSuspension({ phase: "commercial_draining" }, 0)
    ).toEqual({ phase: "suspended", mode: "commercial" });
  });
});
