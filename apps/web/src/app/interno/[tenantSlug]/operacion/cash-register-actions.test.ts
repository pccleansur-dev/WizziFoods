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
const paymentId = "33333333-3333-4333-8333-333333333333";
const shiftId = "44444444-4444-4444-8444-444444444444";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status
  });
}

describe("cash register server actions", () => {
  beforeEach(() => {
    cookieValue.mockReset().mockReturnValue(token);
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("opens the register through the session cookie only", async () => {
    const data = {
      openedAt: "2026-10-24T10:00:00.000Z",
      openingCashCents: 5_000,
      shiftId
    };
    fetchMock.mockResolvedValue(json(200, { data }));
    const { openShiftAction } = await import("./cash-register-actions");
    await expect(
      openShiftAction("bar", { commandId, openingCashCents: 5_000 })
    ).resolves.toEqual({ data, status: "ok" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://api.localhost:3001/v1/staff/cash-register/open");
    expect(init.headers.authorization).toBe(`Bearer ${token}`);
    expect(JSON.parse(init.body)).toEqual({
      commandId,
      openingCashCents: 5_000
    });
  });

  it("sends only the counted cash when closing and shows a difference first", async () => {
    fetchMock.mockResolvedValue(
      json(200, { data: { closed: false, differenceCents: -700, shiftId } })
    );
    const { closeShiftAction } = await import("./cash-register-actions");
    await expect(
      closeShiftAction("bar", {
        commandId,
        countedCashCents: 15_300,
        reason: null
      })
    ).resolves.toEqual({
      data: { closed: false, differenceCents: -700, shiftId },
      status: "ok"
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://api.localhost:3001/v1/staff/cash-register/close");
    expect(JSON.parse(init.body)).toEqual({
      commandId,
      countedCashCents: 15_300,
      reason: null
    });
  });

  it("records movements and refunds on their own routes", async () => {
    const { recordCashMovementAction, recordRefundAction } =
      await import("./cash-register-actions");
    fetchMock.mockResolvedValueOnce(
      json(200, {
        data: {
          amountCents: 2_000,
          kind: "cash_out",
          movementId: shiftId,
          shiftId
        }
      })
    );
    await recordCashMovementAction("bar", {
      amountCents: 2_000,
      commandId,
      kind: "cash_out",
      reason: "Retiro a caja fuerte"
    });
    fetchMock.mockResolvedValueOnce(
      json(200, {
        data: {
          paymentId,
          pendingCents: 0,
          refundCents: 4_000,
          sessionId,
          shiftId
        }
      })
    );
    await recordRefundAction("bar", sessionId, {
      amountCents: 4_000,
      commandId,
      itemLineId: null,
      paymentId,
      reason: "Se terminó"
    });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "http://api.localhost:3001/v1/staff/cash-register/movements",
      `http://api.localhost:3001/v1/staff/accounts/${sessionId}/refunds`
    ]);
  });

  it("translates a closed register and a refused refund", async () => {
    const { recordRefundAction } = await import("./cash-register-actions");
    fetchMock.mockResolvedValue(
      json(409, { error: { code: "REFUND_EXCEEDS_LIMIT", message: "x" } })
    );
    await expect(
      recordRefundAction("bar", sessionId, {
        amountCents: 4_001,
        commandId,
        itemLineId: null,
        paymentId,
        reason: "x"
      })
    ).resolves.toMatchObject({
      code: "REFUND_EXCEEDS_LIMIT",
      message: expect.stringContaining("devolución"),
      status: "error"
    });
  });

  it("fails closed without a session cookie and never calls the API", async () => {
    cookieValue.mockReturnValue(undefined);
    const { openShiftAction } = await import("./cash-register-actions");
    await expect(
      openShiftAction("bar", { commandId, openingCashCents: 0 })
    ).resolves.toMatchObject({
      code: "STAFF_SESSION_INVALID",
      status: "error"
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects forged bodies and malformed identifiers before the API", async () => {
    const { closeShiftAction, openShiftAction, recordRefundAction } =
      await import("./cash-register-actions");
    await expect(
      openShiftAction("bar", { commandId, openingCashCents: -1 })
    ).resolves.toMatchObject({ status: "error" });
    await expect(
      closeShiftAction("bar", {
        commandId,
        countedCashCents: 1,
        expectedCashCents: 1,
        reason: null
      } as never)
    ).resolves.toMatchObject({ status: "error" });
    await expect(
      recordRefundAction("bar", "nope", {
        amountCents: 1,
        commandId,
        itemLineId: null,
        paymentId,
        reason: "x"
      })
    ).resolves.toMatchObject({ status: "error" });
    await expect(
      recordRefundAction("bar", sessionId, {
        amountCents: 1,
        cardNumber: "4111111111111111",
        commandId,
        itemLineId: null,
        paymentId,
        reason: "x"
      } as never)
    ).resolves.toMatchObject({ status: "error" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
