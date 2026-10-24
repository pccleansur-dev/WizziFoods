import { describe, expect, it } from "vitest";

import {
  PAYMENT_METHOD_KEYS,
  parsePaymentMethodKey,
  parsePaymentMethodStatuses,
  parsePaymentMethodUpdate,
  parsePaymentSecretRequest
} from "./payment-methods.js";

function statuses(extra: Record<string, unknown> = {}) {
  return PAYMENT_METHOD_KEYS.map((method) => ({
    available: method === "cash",
    configured: false,
    enabled: method === "cash",
    method,
    publicConfig: {},
    updatedAt: "2026-10-24T00:00:00Z",
    ...extra
  }));
}

describe("payment method contracts", () => {
  it("accepts only known method keys", () => {
    expect(parsePaymentMethodKey("cash")).toBe("cash");
    expect(parsePaymentMethodKey("bitcoin")).toBeNull();
    expect(parsePaymentMethodKey("__proto__")).toBeNull();
  });

  it("validates updates and public configuration per method", () => {
    expect(parsePaymentMethodUpdate("cash", { enabled: false }).ok).toBe(true);
    expect(
      parsePaymentMethodUpdate("mercado_pago", {
        enabled: true,
        publicConfig: { publicKey: "APP_USR-abcdef123456" }
      }).ok
    ).toBe(true);
    expect(
      parsePaymentMethodUpdate("cash", {
        enabled: true,
        publicConfig: { publicKey: "APP_USR-abcdef123456" }
      }).ok
    ).toBe(false);
    expect(
      parsePaymentMethodUpdate("mercado_pago", {
        enabled: true,
        publicConfig: { publicKey: "bad key" }
      }).ok
    ).toBe(false);
    expect(parsePaymentMethodUpdate("cash", { enabled: "yes" }).ok).toBe(false);
    expect(
      parsePaymentMethodUpdate("cash", { enabled: true, tenantId: "x" }).ok
    ).toBe(false);
    expect(
      parsePaymentMethodUpdate("cash", { enabled: true, secret: "abc" }).ok
    ).toBe(false);
  });

  it("accepts credentials only for provider methods and never echoes them", () => {
    expect(
      parsePaymentSecretRequest("mercado_pago", { secret: "APP_USR-secret-123" })
        .ok
    ).toBe(true);
    expect(
      parsePaymentSecretRequest("cash", { secret: "APP_USR-secret-123" }).ok
    ).toBe(false);
    const bad = parsePaymentSecretRequest("mercado_pago", {
      secret: "has spaces in it"
    });
    expect(bad.ok).toBe(false);
    expect(JSON.stringify(bad)).not.toContain("has spaces");
    expect(parsePaymentSecretRequest("mercado_pago", { secret: "short" }).ok).toBe(
      false
    );
    expect(
      parsePaymentSecretRequest("mercado_pago", {
        secret: "APP_USR-secret-123",
        extra: 1
      }).ok
    ).toBe(false);
  });

  it("rejects status rows that expose credential material", () => {
    expect(parsePaymentMethodStatuses(statuses())).toHaveLength(5);
    expect(parsePaymentMethodStatuses(statuses({ ciphertext: "00" }))).toBeNull();
    expect(parsePaymentMethodStatuses(statuses({ secret: "x" }))).toBeNull();
    expect(parsePaymentMethodStatuses(statuses().slice(1))).toBeNull();
  });
});
