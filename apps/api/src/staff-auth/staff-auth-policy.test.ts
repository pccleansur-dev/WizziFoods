import { describe, expect, it } from "vitest";

import {
  evaluatePinAttempt,
  isSensitiveRevalidationCurrent,
  staffSessionExpiresAt
} from "./staff-auth-policy.js";

const now = new Date("2026-10-21T18:00:00.000Z");

describe("staff authentication policy", () => {
  it("authenticates and clears previous failures after a valid PIN", () => {
    expect(
      evaluatePinAttempt(
        { failedAttempts: 3, isActive: true, lockedUntil: null },
        true,
        now
      )
    ).toEqual({
      failedAttempts: 0,
      lockedUntil: null,
      result: "authenticated"
    });
  });

  it("locks the account for fifteen minutes after five failures", () => {
    expect(
      evaluatePinAttempt(
        { failedAttempts: 4, isActive: true, lockedUntil: null },
        false,
        now
      )
    ).toEqual({
      failedAttempts: 5,
      lockedUntil: new Date("2026-10-21T18:15:00.000Z"),
      result: "locked"
    });
  });

  it("does not evaluate credentials while the lock is active", () => {
    expect(
      evaluatePinAttempt(
        {
          failedAttempts: 5,
          isActive: true,
          lockedUntil: new Date("2026-10-21T18:05:00.000Z")
        },
        true,
        now
      )
    ).toEqual({
      failedAttempts: 5,
      lockedUntil: new Date("2026-10-21T18:05:00.000Z"),
      result: "locked"
    });
  });

  it("starts a fresh counter after an expired lock", () => {
    expect(
      evaluatePinAttempt(
        {
          failedAttempts: 5,
          isActive: true,
          lockedUntil: new Date("2026-10-21T17:59:59.000Z")
        },
        false,
        now
      )
    ).toEqual({
      failedAttempts: 1,
      lockedUntil: null,
      result: "invalid"
    });
  });

  it("denies an inactive staff account without changing counters", () => {
    expect(
      evaluatePinAttempt(
        { failedAttempts: 2, isActive: false, lockedUntil: null },
        true,
        now
      )
    ).toEqual({
      failedAttempts: 2,
      lockedUntil: null,
      result: "inactive"
    });
  });

  it("expires a staff session after eight hours", () => {
    expect(staffSessionExpiresAt(now)).toEqual(
      new Date("2026-10-22T02:00:00.000Z")
    );
  });

  it("requires a recent PIN validation for a sensitive action", () => {
    expect(
      isSensitiveRevalidationCurrent(new Date("2026-10-21T17:45:00.000Z"), now)
    ).toBe(true);
    expect(
      isSensitiveRevalidationCurrent(new Date("2026-10-21T17:44:59.999Z"), now)
    ).toBe(false);
  });
});
