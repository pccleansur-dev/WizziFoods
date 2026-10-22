export type TenantSuspensionMode = "commercial" | "security";

export type TenantSuspensionState =
  | { phase: "none" }
  | { phase: "commercial_draining" }
  | { phase: "suspended"; mode: TenantSuspensionMode };

export interface EvaluateTenantSuspensionInput {
  mode: TenantSuspensionMode;
  activeTableSessions: number;
}

export interface TenantSuspensionDecision {
  state: TenantSuspensionState;
  tenantStatus: "active" | "suspended";
  allowNewTableSessions: false;
  terminateActiveSessions: boolean;
}

function assertActiveTableSessionCount(activeTableSessions: number): void {
  if (!Number.isInteger(activeTableSessions) || activeTableSessions < 0) {
    throw new Error("activeTableSessions must be a non-negative integer");
  }
}

export function evaluateTenantSuspension(
  input: EvaluateTenantSuspensionInput
): TenantSuspensionDecision {
  assertActiveTableSessionCount(input.activeTableSessions);

  if (input.mode === "security") {
    return {
      state: { phase: "suspended", mode: "security" },
      tenantStatus: "suspended",
      allowNewTableSessions: false,
      terminateActiveSessions: true
    };
  }

  if (input.activeTableSessions === 0) {
    return {
      state: { phase: "suspended", mode: "commercial" },
      tenantStatus: "suspended",
      allowNewTableSessions: false,
      terminateActiveSessions: false
    };
  }

  return {
    state: { phase: "commercial_draining" },
    tenantStatus: "active",
    allowNewTableSessions: false,
    terminateActiveSessions: false
  };
}

export function settleCommercialSuspension(
  state: TenantSuspensionState,
  activeTableSessions: number
): TenantSuspensionState {
  assertActiveTableSessionCount(activeTableSessions);

  if (state.phase !== "commercial_draining" || activeTableSessions > 0) {
    return state;
  }

  return { phase: "suspended", mode: "commercial" };
}
