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

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status
  });
}

const advanced = {
  changed: true,
  lineId,
  orderId,
  orderStatus: "in_preparation",
  status: "preparing"
};

describe("production server actions", () => {
  beforeEach(() => {
    cookieValue.mockReset().mockReturnValue(token);
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("advances an item with the Bearer from the session cookie only", async () => {
    fetchMock.mockResolvedValue(json(200, { data: advanced }));
    const { advanceProductionItemAction } =
      await import("./production-actions");
    await expect(
      advanceProductionItemAction("bar", orderId, lineId, {
        commandId,
        status: "preparing"
      })
    ).resolves.toEqual({ data: advanced, status: "ok" });
    expect(cookieValue).toHaveBeenCalledWith("staff_session_bar");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      `http://api.localhost:3001/v1/staff/production/orders/${orderId}/items/${lineId}/status`
    );
    expect(init.headers.authorization).toBe(`Bearer ${token}`);
    expect(JSON.parse(init.body)).toEqual({ commandId, status: "preparing" });
  });

  it("fails closed without a session cookie and never calls the API", async () => {
    cookieValue.mockReturnValue(undefined);
    const { advanceProductionItemAction } =
      await import("./production-actions");
    await expect(
      advanceProductionItemAction("bar", orderId, lineId, {
        commandId,
        status: "ready"
      })
    ).resolves.toMatchObject({
      code: "STAFF_SESSION_INVALID",
      status: "error"
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects malformed identifiers and forged targets before the API", async () => {
    const { advanceProductionItemAction } =
      await import("./production-actions");
    await expect(
      advanceProductionItemAction("bar", "nope", lineId, {
        commandId,
        status: "ready"
      })
    ).resolves.toMatchObject({ status: "error" });
    await expect(
      advanceProductionItemAction("bar", orderId, lineId, {
        commandId,
        status: "queued"
      } as never)
    ).resolves.toMatchObject({ status: "error" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the API error code for a conflicting transition", async () => {
    fetchMock.mockResolvedValue(
      json(409, { error: { code: "PRODUCTION_TRANSITION_INVALID" } })
    );
    const { advanceProductionItemAction } =
      await import("./production-actions");
    await expect(
      advanceProductionItemAction("bar", orderId, lineId, {
        commandId,
        status: "ready"
      })
    ).resolves.toMatchObject({
      code: "PRODUCTION_TRANSITION_INVALID",
      status: "error"
    });
  });
});
