import type { TenantSuspensionMode } from "@platform/contracts";

export type TenantSuspensionRequest = {
  mode: TenantSuspensionMode;
  reason: string;
};

function hasExactKeys(
  value: Record<string, unknown>,
  expected: string[]
): boolean {
  const keys = Object.keys(value).sort();
  return (
    keys.length === expected.length &&
    keys.every((key, index) => key === expected[index])
  );
}

export function parseTenantSuspensionRequest(
  input: unknown
): TenantSuspensionRequest {
  if (!input || typeof input !== "object") {
    throw new Error("Datos de suspensión inválidos.");
  }

  const value = input as Record<string, unknown>;
  const reason =
    typeof value.reason === "string"
      ? value.reason.trim().normalize("NFKC")
      : "";
  if (
    !hasExactKeys(value, ["mode", "reason"]) ||
    (value.mode !== "commercial" && value.mode !== "security") ||
    reason.length < 3 ||
    reason.length > 500
  ) {
    throw new Error("Datos de suspensión inválidos.");
  }

  return { mode: value.mode, reason };
}
