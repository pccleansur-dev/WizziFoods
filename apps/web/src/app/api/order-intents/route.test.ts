import { beforeEach, describe, expect, it, vi } from "vitest";

const tenantFetch = vi.fn();

vi.mock("@platform/config", () => ({
  readWebConfig: () => ({ apiUrl: "http://api.localhost:3001" })
}));
vi.mock("../../panel/tenant-fetch", () => ({ tenantFetch }));

describe("POST /api/order-intents", () => {
  beforeEach(() => tenantFetch.mockReset());

  it("forwards the body with Host and without diner authorization", async () => {
    tenantFetch.mockResolvedValue(new Response("{}", { status: 201 }));
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://bar.localhost:3100/api/order-intents", {
        body: JSON.stringify({ commandId: crypto.randomUUID() }),
        headers: { host: "bar.localhost:3100" },
        method: "POST"
      })
    );
    expect(response.status).toBe(201);
    expect(tenantFetch).toHaveBeenCalledWith(
      "http://api.localhost:3001/v1/public/order-intents",
      expect.objectContaining({
        headers: {
          "content-type": "application/json",
          host: "bar.localhost:3100"
        },
        method: "POST"
      })
    );
  });

  it("rejects oversized payloads before the API", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://bar.localhost:3100/api/order-intents", {
        body: "x".repeat(65_537),
        headers: { host: "bar.localhost:3100" },
        method: "POST"
      })
    );
    expect(response.status).toBe(413);
    expect(tenantFetch).not.toHaveBeenCalled();
  });
});
