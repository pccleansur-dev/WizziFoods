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
const callId = "22222222-2222-4222-8222-222222222222";
const intentId = "33333333-3333-4333-8333-333333333333";
const tableId = "44444444-4444-4444-8444-444444444444";
const lineId = "55555555-5555-4555-8555-555555555555";
const productId = "66666666-6666-4666-8666-666666666666";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status
  });
}

describe("waiter server actions", () => {
  beforeEach(() => {
    cookieValue.mockReset().mockReturnValue(token);
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("claims a call with the Bearer from the session cookie only", async () => {
    fetchMock.mockResolvedValue(
      json(200, {
        data: { callId, claimedByMe: true, status: "acknowledged" }
      })
    );
    const { claimCallAction } = await import("./waiter-actions");
    await expect(claimCallAction("bar", callId, commandId)).resolves.toEqual({
      data: { callId, claimedByMe: true, status: "acknowledged" },
      status: "ok"
    });
    expect(cookieValue).toHaveBeenCalledWith("staff_session_bar");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      `http://api.localhost:3001/v1/staff/calls/${callId}/claim`
    );
    expect(init.headers.authorization).toBe(`Bearer ${token}`);
    expect(JSON.parse(init.body)).toEqual({ commandId });
  });

  it("fails closed without a session cookie and never calls the API", async () => {
    cookieValue.mockReturnValue(undefined);
    const { claimCallAction } = await import("./waiter-actions");
    await expect(
      claimCallAction("bar", callId, commandId)
    ).resolves.toMatchObject({
      code: "STAFF_SESSION_INVALID",
      status: "error"
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects malformed identifiers before the API", async () => {
    const { claimCallAction, decideIntentAction } =
      await import("./waiter-actions");
    await expect(
      claimCallAction("bar", "not-a-uuid", commandId)
    ).resolves.toMatchObject({ status: "error" });
    await expect(
      decideIntentAction("bar", intentId, {
        commandId,
        decision: "reject",
        reason: ""
      })
    ).resolves.toMatchObject({ status: "error" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("translates API conflicts into a clear message", async () => {
    fetchMock.mockResolvedValue(
      json(409, {
        error: { code: "CALL_ALREADY_CLAIMED", message: "internal text" }
      })
    );
    const { claimCallAction } = await import("./waiter-actions");
    await expect(claimCallAction("bar", callId, commandId)).resolves.toEqual({
      code: "CALL_ALREADY_CLAIMED",
      message: "Otro mozo ya tomó este llamado.",
      status: "error"
    });
  });

  it("confirms an intent keeping payment unrecorded", async () => {
    const order = {
      accountDecision: "pending",
      items: [
        {
          lineId,
          productId,
          quantity: 1,
          title: "Milanesa",
          totalCents: 12_500,
          unitPriceCents: 12_500,
          variantId: null,
          variantTitle: null
        }
      ],
      orderId: "77777777-7777-4777-8777-777777777777",
      payment: { state: "not_recorded" },
      source: "intent",
      status: "confirmed",
      tableId,
      totalCents: 12_500
    };
    fetchMock.mockResolvedValue(
      json(200, { data: { decision: "confirmed", order } })
    );
    const { decideIntentAction } = await import("./waiter-actions");
    const result = await decideIntentAction("bar", intentId, {
      commandId,
      decision: "confirm",
      reason: null
    });
    expect(result).toEqual({
      data: { decision: "confirmed", order },
      status: "ok"
    });
  });

  it("refuses an API answer that claims a payment", async () => {
    fetchMock.mockResolvedValue(
      json(200, {
        data: {
          decision: "confirmed",
          order: { payment: { state: "paid" } }
        }
      })
    );
    const { decideIntentAction } = await import("./waiter-actions");
    await expect(
      decideIntentAction("bar", intentId, {
        commandId,
        decision: "confirm",
        reason: null
      })
    ).resolves.toMatchObject({ status: "error" });
  });

  it("forwards a manual order only if it matches the strict contract", async () => {
    const { createManualOrderAction } = await import("./waiter-actions");
    const request = {
      attribution: "table" as const,
      commandId,
      dinerName: null,
      items: [{ lineId, productId, quantity: 1, variantId: null }],
      seatLabel: null,
      tableId
    };
    await expect(
      createManualOrderAction("bar", { ...request, totalCents: 1 } as never)
    ).resolves.toMatchObject({ status: "error" });
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValue(json(500, { error: { code: "X" } }));
    await expect(
      createManualOrderAction("bar", request)
    ).resolves.toMatchObject({ status: "error" });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual(request);
  });
});
