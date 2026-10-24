import { describe, expect, it } from "vitest";

import { PaymentSecretSealer } from "./payment-secret-sealer.js";

const key = Buffer.alloc(32, 9);
const scope = {
  locationId: "a8000000-0000-4000-8000-000000000008",
  tenantId: "a3000000-0000-4000-8000-000000000003"
};
const secret = "APP_USR-0123456789-super-secret-token";

describe("PaymentSecretSealer", () => {
  it("round-trips a credential without storing it in clear", () => {
    const sealer = new PaymentSecretSealer(key);
    const sealed = sealer.seal(secret, scope, "mercado_pago");
    expect(sealed.ciphertext.includes(Buffer.from(secret))).toBe(false);
    expect(sealed.ciphertext.length).toBeGreaterThanOrEqual(29);
    expect(sealer.open(sealed.ciphertext, scope, "mercado_pago")).toBe(secret);
  });

  it("uses a fresh nonce for the same input", () => {
    const sealer = new PaymentSecretSealer(key);
    expect(sealer.seal(secret, scope, "mercado_pago").ciphertext).not.toEqual(
      sealer.seal(secret, scope, "mercado_pago").ciphertext
    );
  });

  it("refuses a ciphertext moved to another tenant, location or method", () => {
    const sealer = new PaymentSecretSealer(key);
    const { ciphertext } = sealer.seal(secret, scope, "mercado_pago");
    expect(() =>
      sealer.open(
        ciphertext,
        { ...scope, tenantId: "a4000000-0000-4000-8000-000000000004" },
        "mercado_pago"
      )
    ).toThrow();
    expect(() =>
      sealer.open(
        ciphertext,
        { ...scope, locationId: "a9000000-0000-4000-8000-000000000009" },
        "mercado_pago"
      )
    ).toThrow();
    expect(() => sealer.open(ciphertext, scope, "cash")).toThrow();
  });

  it("detects tampering and a different key", () => {
    const sealer = new PaymentSecretSealer(key);
    const { ciphertext } = sealer.seal(secret, scope, "mercado_pago");
    const tampered = Buffer.from(ciphertext);
    tampered[tampered.length - 1] = (tampered.at(-1) ?? 0) ^ 1;
    expect(() => sealer.open(tampered, scope, "mercado_pago")).toThrow();
    expect(() =>
      new PaymentSecretSealer(Buffer.alloc(32, 1)).open(
        ciphertext,
        scope,
        "mercado_pago"
      )
    ).toThrow();
  });

  it("requires a 32 byte key", () => {
    expect(() => new PaymentSecretSealer(Buffer.alloc(16))).toThrow();
  });
});
