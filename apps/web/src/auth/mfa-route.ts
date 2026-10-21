export type AssuranceLevel = "aal1" | "aal2" | null;

export type MfaSessionState = {
  currentLevel: AssuranceLevel;
  nextLevel: AssuranceLevel;
  verifiedFactorCount: number;
};

export function resolveMfaRoute(state: MfaSessionState | null): string {
  if (!state) return "/acceso";
  if (state.currentLevel === "aal2") return "/panel";

  if (state.nextLevel === "aal2" && state.verifiedFactorCount > 0) {
    return "/acceso/segundo-factor";
  }

  return "/acceso/configurar-segundo-factor";
}
