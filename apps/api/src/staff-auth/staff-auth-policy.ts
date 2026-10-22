import { STAFF_AUTH_POLICY } from "@platform/contracts";

export type StaffCredentialState = {
  failedAttempts: number;
  isActive: boolean;
  lockedUntil: Date | null;
};

export type PinAttemptResult = {
  failedAttempts: number;
  lockedUntil: Date | null;
  result: "authenticated" | "inactive" | "invalid" | "locked";
};

export function evaluatePinAttempt(
  state: StaffCredentialState,
  pinMatches: boolean,
  now: Date
): PinAttemptResult {
  if (!state.isActive) {
    return {
      failedAttempts: state.failedAttempts,
      lockedUntil: state.lockedUntil,
      result: "inactive"
    };
  }

  if (state.lockedUntil && state.lockedUntil > now) {
    return {
      failedAttempts: state.failedAttempts,
      lockedUntil: state.lockedUntil,
      result: "locked"
    };
  }

  if (pinMatches) {
    return { failedAttempts: 0, lockedUntil: null, result: "authenticated" };
  }

  const failedAttempts =
    state.lockedUntil && state.lockedUntil <= now
      ? 1
      : state.failedAttempts + 1;

  if (failedAttempts >= STAFF_AUTH_POLICY.maxFailedAttempts) {
    return {
      failedAttempts,
      lockedUntil: new Date(
        now.getTime() + STAFF_AUTH_POLICY.lockDurationMinutes * 60_000
      ),
      result: "locked"
    };
  }

  return { failedAttempts, lockedUntil: null, result: "invalid" };
}

export function staffSessionExpiresAt(createdAt: Date): Date {
  return new Date(
    createdAt.getTime() + STAFF_AUTH_POLICY.sessionDurationHours * 3_600_000
  );
}

export function isSensitiveRevalidationCurrent(
  revalidatedAt: Date,
  now: Date
): boolean {
  const validAfter =
    now.getTime() - STAFF_AUTH_POLICY.sensitiveRevalidationMinutes * 60_000;
  return revalidatedAt.getTime() >= validAfter && revalidatedAt <= now;
}
