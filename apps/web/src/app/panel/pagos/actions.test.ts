import { beforeEach, describe, expect, it, vi } from "vitest";

const adminApi = vi.fn();
vi.mock("../admin-api", () => ({
  adminApi: (...args: unknown[]) => adminApi(...args),
  dataOf: (body: { data?: unknown }) => body?.data
}));

const { paymentsCommandAction } = await import("./actions");

const secret = "APP_USR-0123456789-web-secret";
const statuses = [
  "cash",
  "credit_card",
  "debit_card",
  "other_in_person",
  "mercado_pago"
].map((method) => ({
  available: method === "cash",
  configured: false,
  enabled: method === "cash",
  method,
  publicConfig: {},
  updatedAt: "2026-10-24T00:00:00Z"
}));

describe("paymentsCommandAction", () => {
  beforeEach(() => adminApi.mockReset());

  it("rejects invalid input before calling the API", async () => {
    const result = await paymentsCommandAction({
      method: "cash",
      secret,
      type: "credential"
    });
    expect(result.status).toBe("invalid");
    expect(adminApi).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("forwards the credential but never returns it", async () => {
    adminApi.mockResolvedValue({
      body: { data: statuses },
      ok: true,
      status: 200
    });
    const result = await paymentsCommandAction({
      method: "mercado_pago",
      secret,
      type: "credential"
    });
    expect(adminApi).toHaveBeenCalledWith(
      "/v1/tenant/payment-methods/mercado_pago/credential",
      { body: { secret }, method: "PUT" }
    );
    expect(result.status).toBe("saved");
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("surfaces the API explanation when the last method is protected", async () => {
    adminApi.mockResolvedValue({
      code: "PAYMENT_LAST_METHOD",
      message: "Debe quedar al menos un medio de pago disponible.",
      ok: false,
      status: 409
    });
    const result = await paymentsCommandAction({
      enabled: false,
      method: "cash",
      publicKey: null,
      type: "update"
    });
    expect(result).toMatchObject({
      message: "Debe quedar al menos un medio de pago disponible.",
      status: "invalid"
    });
  });
});
