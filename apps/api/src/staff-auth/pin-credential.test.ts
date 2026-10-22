import { describe, expect, it } from "vitest";

import { hashStaffPin, verifyStaffPin } from "./pin-credential.js";

const pepper = "test-only-pepper-with-more-than-32-characters";

describe("staff PIN credentials", () => {
  it("hashes a six-digit PIN with a random salt", async () => {
    const first = await hashStaffPin("194827", pepper);
    const second = await hashStaffPin("194827", pepper);

    expect(first).toMatch(/^scrypt-v1\$/u);
    expect(first).not.toContain("194827");
    expect(second).not.toBe(first);
    await expect(verifyStaffPin("194827", first, pepper)).resolves.toBe(true);
  });

  it("rejects an incorrect PIN without exposing it", async () => {
    const credential = await hashStaffPin("194827", pepper);

    await expect(verifyStaffPin("000000", credential, pepper)).resolves.toBe(
      false
    );
  });

  it.each(["12345", "1234567", "12A456", "１２３４５６"])(
    "rejects an invalid PIN shape: %s",
    async (pin) => {
      await expect(hashStaffPin(pin, pepper)).rejects.toThrow(
        "El PIN debe tener exactamente seis dígitos."
      );
    }
  );

  it("rejects a weak server-side pepper", async () => {
    await expect(hashStaffPin("194827", "too-short")).rejects.toThrow(
      "STAFF_PIN_PEPPER debe tener al menos 32 caracteres."
    );
  });

  it("treats malformed stored credentials as invalid", async () => {
    await expect(
      verifyStaffPin("194827", "not-a-credential", pepper)
    ).resolves.toBe(false);
  });
});
