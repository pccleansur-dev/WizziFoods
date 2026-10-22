export type GrantSupportAccessRequest = {
  durationMinutes: number;
  reason: string;
  supportUserId: string;
};

export type RevokeSupportAccessRequest = { reason: string };

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

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

function normalizeReason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const reason = value.trim().normalize("NFKC");
  return reason.length >= 3 && reason.length <= 500 ? reason : null;
}

export function parseGrantSupportAccessRequest(
  input: unknown
): GrantSupportAccessRequest {
  if (!input || typeof input !== "object") {
    throw new Error("Datos de autorización de soporte inválidos.");
  }
  const value = input as Record<string, unknown>;
  const reason = normalizeReason(value.reason);
  if (
    !hasExactKeys(value, ["durationMinutes", "reason", "supportUserId"]) ||
    typeof value.supportUserId !== "string" ||
    !uuidPattern.test(value.supportUserId) ||
    !Number.isInteger(value.durationMinutes) ||
    (value.durationMinutes as number) < 15 ||
    (value.durationMinutes as number) > 240 ||
    !reason
  ) {
    throw new Error("Datos de autorización de soporte inválidos.");
  }
  return {
    durationMinutes: value.durationMinutes as number,
    reason,
    supportUserId: value.supportUserId
  };
}

export function parseRevokeSupportAccessRequest(
  input: unknown
): RevokeSupportAccessRequest {
  if (!input || typeof input !== "object") {
    throw new Error("Datos de revocación de soporte inválidos.");
  }
  const value = input as Record<string, unknown>;
  const reason = normalizeReason(value.reason);
  if (!hasExactKeys(value, ["reason"]) || !reason) {
    throw new Error("Datos de revocación de soporte inválidos.");
  }
  return { reason };
}
