import { beforeEach, describe, expect, it, vi } from "vitest";

const cookieValue = vi.fn<(name: string) => string | undefined>();
const fetchMock = vi.fn();

vi.mock("@platform/config", () => ({
  readWebConfig: () => ({ apiUrl: "http://api.localhost:3001" })
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieValue(name);
      return value === undefined ? undefined : { value };
    }
  })
}));

const token = "A".repeat(43);
const commandId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status
  });
}

const payment = {
  amountCents: 10_000,
  paymentCents: 10_500,
  paymentId: "33333333-3333-4333-8333-333333333333",
  pendingCents: 5_000,
  sessionId,
  shiftId: "44444444-4444-4444-8444-444444444444",
  tipCents: 500
};

describe("account server actions", () => {
  beforeEach(() => {
    cookieValue.mockReset().mockReturnValue(token);
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("records a payment through the session cookie only", async () => {
    fetchMock.mockResolvedValue(json(200, { data: payment }));
    const { recordPaymentAction } = await import("./account-actions");
    await expect(
      recordPaymentAction("bar", sessionId, {
        amountCents: 10_000,
        commandId,
        method: "cash",
        tipCents: 500
      })
    ).resolves.toEqual({ data: payment, status: "ok" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      `http://api.localhost:3001/v1/staff/accounts/${sessionId}/payments`
    );
    expect(init.headers.authorization).toBe(`Bearer ${token}`);
    expect(JSON.parse(init.body)).toEqual({
      amountCents: 10_000,
      commandId,
      method: "cash",
      tipCents: 500
    });
  });

  it("applies a discount and keeps an account open on their own routes", async () => {
    const { applyDiscountAction, keepAccountOpenAction } =
      await import("./account-actions");
    fetchMock.mockResolvedValueOnce(
      json(200, {
        data: { discountCents: 2_190, pendingCents: 19_710, sessionId }
      })
    );
    await applyDiscountAction("bar", sessionId, {
      commandId,
      kind: "percent",
      reason: "Cortesía",
      value: 1_000
    });
    fetchMock.mockResolvedValueOnce(
      json(200, {
        data: { decision: "keep_open", pendingCents: 8_000, sessionId }
      })
    );
    await keepAccountOpenAction("bar", sessionId, { commandId });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `http://api.localhost:3001/v1/staff/accounts/${sessionId}/discounts`,
      `http://api.localhost:3001/v1/staff/accounts/${sessionId}/keep-open`
    ]);
  });

  it("sends an online refund only to the Mercado Pago endpoint", async () => {
    const { refundOnlinePaymentAction } = await import("./account-actions");
    fetchMock.mockResolvedValue(
      json(200, {
        data: {
          paymentId: "33333333-3333-4333-8333-333333333333",
          refundedCents: 4_000
        }
      })
    );
    await expect(
      refundOnlinePaymentAction("bar", sessionId, {
        amountCents: 4_000,
        commandId,
        paymentId: "33333333-3333-4333-8333-333333333333",
        reason: "Producto cancelado"
      })
    ).resolves.toMatchObject({ status: "ok" });
    expect(fetchMock.mock.calls[0]![0]).toBe(
      `http://api.localhost:3001/v1/staff/accounts/${sessionId}/online-refunds`
    );
  });

  it("fails closed without a session cookie and never calls the API", async () => {
    cookieValue.mockReturnValue(undefined);
    const { recordPaymentAction } = await import("./account-actions");
    await expect(
      recordPaymentAction("bar", sessionId, {
        amountCents: null,
        commandId,
        method: "cash",
        tipCents: 0
      })
    ).resolves.toMatchObject({
      code: "STAFF_SESSION_INVALID",
      status: "error"
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects malformed identifiers and forged bodies before the API", async () => {
    const { applyDiscountAction, recordPaymentAction } =
      await import("./account-actions");
    await expect(
      recordPaymentAction("bar", "nope", {
        amountCents: null,
        commandId,
        method: "cash",
        tipCents: 0
      })
    ).resolves.toMatchObject({ status: "error" });
    await expect(
      recordPaymentAction("bar", sessionId, {
        amountCents: null,
        commandId,
        method: "mercado_pago",
        tipCents: 0
      } as never)
    ).resolves.toMatchObject({ status: "error" });
    await expect(
      applyDiscountAction("bar", sessionId, {
        commandId,
        kind: "percent",
        reason: " ",
        value: 1_000
      })
    ).resolves.toMatchObject({ status: "error" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the API error code and message", async () => {
    fetchMock.mockResolvedValue(
      json(409, { error: { code: "PAYMENT_EXCEEDS_PENDING" } })
    );
    const { recordPaymentAction } = await import("./account-actions");
    await expect(
      recordPaymentAction("bar", sessionId, {
        amountCents: 99_999,
        commandId,
        method: "cash",
        tipCents: 0
      })
    ).resolves.toMatchObject({
      code: "PAYMENT_EXCEEDS_PENDING",
      message: expect.stringContaining("saldo pendiente"),
      status: "error"
    });
  });
});

describe("split server actions", () => {
  beforeEach(() => {
    cookieValue.mockReset().mockReturnValue(token);
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  const share = (position: number) => ({
    amountCents: 500,
    items: [],
    payerLabel: null,
    position,
    status: "open"
  });
  const split = {
    baseCents: 1000,
    kind: "equal",
    parts: 2,
    sharedItems: [],
    shares: [share(1), share(2)],
    splitId: sessionId
  };

  it("splits and pays shares on their own routes", async () => {
    const { createSplitAction, paySharesAction } =
      await import("./account-actions");
    fetchMock.mockResolvedValueOnce(
      json(200, { data: { pendingCents: 1000, sessionId, split } })
    );
    await expect(
      createSplitAction("bar", sessionId, { commandId, parts: 2 })
    ).resolves.toMatchObject({ status: "ok" });
    fetchMock.mockResolvedValueOnce(
      json(200, {
        data: {
          ...payment,
          positions: [1],
          split: null,
          splitId: sessionId
        }
      })
    );
    await expect(
      paySharesAction("bar", sessionId, {
        commandId,
        method: "cash",
        payerLabel: "Ana",
        positions: [1],
        splitId: sessionId,
        tipCents: 0
      })
    ).resolves.toMatchObject({ status: "ok" });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `http://api.localhost:3001/v1/staff/accounts/${sessionId}/splits`,
      `http://api.localhost:3001/v1/staff/accounts/${sessionId}/split-payments`
    ]);
  });

  it("rejects forged bodies before the API", async () => {
    const { createSplitAction, paySharesAction } =
      await import("./account-actions");
    await expect(
      createSplitAction("bar", sessionId, { commandId, parts: 1 })
    ).resolves.toMatchObject({ status: "error" });
    await expect(
      paySharesAction("bar", sessionId, {
        commandId,
        method: "mercado_pago",
        payerLabel: null,
        positions: [1],
        splitId: sessionId,
        tipCents: 0
      } as never)
    ).resolves.toMatchObject({ status: "error" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
