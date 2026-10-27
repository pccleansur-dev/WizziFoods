import { beforeEach, describe, expect, it, vi } from "vitest";

const tenantFetch = vi.fn();

vi.mock("@platform/config", () => ({
  readWebAuthConfig: () => ({
    supabasePublishableKey: "sb_publishable_test_key",
    supabaseUrl: "http://localhost:18000"
  }),
  readWebConfig: () => ({ apiUrl: "http://api.localhost:3001" })
}));
vi.mock("../../panel/tenant-fetch", () => ({ tenantFetch }));

const channel =
  "tenant:3e200000-0000-4000-8000-000000000001:location:3e200000-0000-4000-8000-000000000002:table-3e600000-0000-4000-8000-000000000001";
const grant = {
  channels: [channel],
  expiresAt: "2026-10-31T12:10:00.000Z",
  token: "aaa.bbb.ccc"
};

function request(body: string, host = "bar.localhost:3100") {
  return new Request("http://bar.localhost:3100/api/diner-realtime", {
    body,
    headers: host ? { host } : {},
    method: "POST"
  });
}

describe("diner realtime route", () => {
  beforeEach(() => tenantFetch.mockClear());

  it("forwards the QR with the host and returns the grant with where to connect", async () => {
    tenantFetch.mockResolvedValue(
      Response.json({ data: grant }, { status: 200 })
    );
    const { POST } = await import("./route");
    const response = await POST(request('{"token":"x"}'));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      ...grant,
      publishableKey: "sb_publishable_test_key",
      url: "http://localhost:18000"
    });
    expect(tenantFetch).toHaveBeenCalledWith(
      "http://api.localhost:3001/v1/public/realtime/token",
      expect.objectContaining({
        headers: {
          "content-type": "application/json",
          host: "bar.localhost:3100"
        },
        method: "POST"
      })
    );
  });

  it.each([404, 503])("passes a %i from the API through", async (status) => {
    const { POST } = await import("./route");
    tenantFetch.mockResolvedValue(Response.json({}, { status }));
    expect((await POST(request("{}"))).status).toBe(status);
  });

  it("never invents a grant from an answer it does not understand", async () => {
    const { POST } = await import("./route");
    tenantFetch.mockResolvedValue(
      Response.json({ data: { token: "no" } }, { status: 200 })
    );
    expect((await POST(request("{}"))).status).toBe(502);
  });

  it("says it is not available when the API cannot be reached", async () => {
    const { POST } = await import("./route");
    tenantFetch.mockImplementationOnce(async () => {
      throw new Error("down");
    });
    expect((await POST(request("{}"))).status).toBe(503);
  });

  it("refuses a request with no host or too large", async () => {
    const { POST } = await import("./route");
    expect((await POST(request("{}", ""))).status).toBe(404);
    expect((await POST(request("x".repeat(600)))).status).toBe(413);
    expect(tenantFetch).not.toHaveBeenCalled();
  });
});
