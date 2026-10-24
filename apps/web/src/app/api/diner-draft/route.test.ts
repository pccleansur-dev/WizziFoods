import { beforeEach, describe, expect, it, vi } from "vitest";

const tenantFetch = vi.fn();

vi.mock("@platform/config", () => ({
  readWebConfig: () => ({ apiUrl: "http://api.localhost:3001" })
}));
vi.mock("../../panel/tenant-fetch", () => ({ tenantFetch }));

describe("POST /api/diner-draft", () => {
  beforeEach(() => tenantFetch.mockReset());

  it("forwards the body with the browser tenant host and no authorization", async () => {
    tenantFetch.mockResolvedValue(
      new Response(JSON.stringify({ data: { status: "ok" } }), {
        headers: { "content-type": "application/json" },
        status: 200
      })
    );
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://bar.localhost:3100/api/diner-draft", {
        body: JSON.stringify({ items: [], token: "ab".repeat(32) }),
        headers: {
          "content-type": "application/json",
          host: "bar.localhost:3100"
        },
        method: "POST"
      })
    );
    expect(response.status).toBe(200);
    expect(tenantFetch).toHaveBeenCalledWith(
      "http://api.localhost:3001/v1/public/drafts/recalculate",
      expect.objectContaining({
        headers: {
          "content-type": "application/json",
          host: "bar.localhost:3100"
        },
        method: "POST"
      })
    );
  });
});
