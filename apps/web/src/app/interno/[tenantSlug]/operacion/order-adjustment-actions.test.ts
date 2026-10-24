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
const orderId = "22222222-2222-4222-8222-222222222222";
const lineId = "33333333-3333-4333-8333-333333333333";
const productId = "44444444-4444-4444-8444-444444444444";
const adjustmentId = "55555555-5555-4555-8555-555555555555";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status
  });
}

const itemState = {
  changed: true,
  lineId,
  orderId,
  orderStatus: "ready",
  status: "delivered"
};

describe("order adjustment server actions", () => {
  beforeEach(() => {
    cookieValue.mockReset().mockReturnValue(token);
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("delivers an item through the session cookie only", async () => {
    fetchMock.mockResolvedValue(json(200, { data: itemState }));
    const { deliverItemAction } = await import("./order-adjustment-actions");
    await expect(
      deliverItemAction("bar", orderId, lineId, { commandId })
    ).resolves.toEqual({ data: itemState, status: "ok" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      `http://api.localhost:3001/v1/staff/orders/${orderId}/items/${lineId}/delivery`
    );
    expect(init.headers.authorization).toBe(`Bearer ${token}`);
    expect(JSON.parse(init.body)).toEqual({ commandId });
  });

  it("reports a shortage on the production route", async () => {
    fetchMock.mockResolvedValue(
      json(200, {
        data: { ...itemState, orderStatus: "exception", status: "exception" }
      })
    );
    const { reportProductionExceptionAction } =
      await import("./order-adjustment-actions");
    const result = await reportProductionExceptionAction(
      "bar",
      orderId,
      lineId,
      {
        commandId,
        reason: "Se terminó"
      }
    );
    expect(result.status).toBe("ok");
    expect(fetchMock.mock.calls[0]![0]).toBe(
      `http://api.localhost:3001/v1/staff/production/orders/${orderId}/items/${lineId}/exception`
    );
  });

  it("proposes, decides and cancels on their own routes", async () => {
    const {
      cancelItemAction,
      decideReplacementAction,
      proposeReplacementAction
    } = await import("./order-adjustment-actions");
    fetchMock.mockResolvedValueOnce(
      json(200, {
        data: {
          adjustmentId,
          differenceCents: 50,
          lineId,
          orderId,
          originalTotalCents: 100,
          replacementTitle: "Vino",
          replacementTotalCents: 150,
          replacementVariantTitle: null,
          status: "proposed"
        }
      })
    );
    await proposeReplacementAction("bar", orderId, lineId, {
      commandId,
      productId,
      variantId: null
    });
    fetchMock.mockResolvedValueOnce(
      json(200, {
        data: {
          adjustmentId,
          orderStatus: "queued",
          replacementLineId: lineId,
          status: "accepted"
        }
      })
    );
    await decideReplacementAction("bar", adjustmentId, {
      commandId,
      decision: "accept",
      reason: null
    });
    fetchMock.mockResolvedValueOnce(
      json(200, {
        data: {
          adjustmentId,
          differenceCents: -100,
          lineId,
          orderId,
          orderStatus: "cancelled",
          status: "cancelled"
        }
      })
    );
    await cancelItemAction("bar", orderId, lineId, {
      commandId,
      reason: "Sin reemplazo"
    });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `http://api.localhost:3001/v1/staff/orders/${orderId}/items/${lineId}/replacement`,
      `http://api.localhost:3001/v1/staff/order-adjustments/${adjustmentId}/decision`,
      `http://api.localhost:3001/v1/staff/orders/${orderId}/items/${lineId}/cancellation`
    ]);
  });

  it("fails closed without a session cookie and never calls the API", async () => {
    cookieValue.mockReturnValue(undefined);
    const { deliverItemAction } = await import("./order-adjustment-actions");
    await expect(
      deliverItemAction("bar", orderId, lineId, { commandId })
    ).resolves.toMatchObject({
      code: "STAFF_SESSION_INVALID",
      status: "error"
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects malformed identifiers and forged bodies before the API", async () => {
    const { cancelItemAction, deliverItemAction } =
      await import("./order-adjustment-actions");
    await expect(
      deliverItemAction("bar", "nope", lineId, { commandId })
    ).resolves.toMatchObject({ status: "error" });
    await expect(
      cancelItemAction("bar", orderId, lineId, { commandId, reason: "  " })
    ).resolves.toMatchObject({ status: "error" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the API error code", async () => {
    fetchMock.mockResolvedValue(
      json(409, { error: { code: "ITEM_NOT_READY" } })
    );
    const { deliverItemAction } = await import("./order-adjustment-actions");
    await expect(
      deliverItemAction("bar", orderId, lineId, { commandId })
    ).resolves.toMatchObject({ code: "ITEM_NOT_READY", status: "error" });
  });
});
