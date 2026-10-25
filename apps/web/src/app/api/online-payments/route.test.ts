import { beforeEach, describe, expect, it, vi } from "vitest";

const tenantFetch = vi.fn();
vi.mock("../../panel/tenant-fetch", () => ({
  tenantFetch: (...args: unknown[]) => tenantFetch(...args)
}));
vi.mock("@platform/config", () => ({
  readWebConfig: () => ({ apiUrl: "http://api.local" })
}));

const { POST } = await import("./route");

describe("online payment route", () => {
  beforeEach(() => tenantFetch.mockReset());

  it("preserves the tenant host and forwards only to the start endpoint", async () => {
    tenantFetch.mockResolvedValue(
      new Response(JSON.stringify({ data: { mode: "sandbox" } }), {
        headers: { "content-type": "application/json" },
        status: 200
      })
    );
    const response = await POST(
      new Request("http://local/api/online-payments", {
        body: JSON.stringify({ intentId: "x", token: "y" }),
        headers: {
          "content-type": "application/json",
          host: "comedor.dev.localhost"
        },
        method: "POST"
      })
    );

    expect(response.status).toBe(200);
    expect(tenantFetch).toHaveBeenCalledWith(
      "http://api.local/v1/public/online-payments",
      expect.objectContaining({
        headers: {
          "content-type": "application/json",
          host: "comedor.dev.localhost"
        },
        method: "POST"
      })
    );
  });

  it("refuses oversized bodies before contacting the API", async () => {
    const response = await POST(
      new Request("http://local/api/online-payments", {
        body: "x",
        headers: { "content-length": "70000", host: "local.test" },
        method: "POST"
      })
    );
    expect(response.status).toBe(413);
    expect(tenantFetch).not.toHaveBeenCalled();
  });
});
