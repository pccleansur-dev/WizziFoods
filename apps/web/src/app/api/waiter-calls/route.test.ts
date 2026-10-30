import { beforeEach, describe, expect, it, vi } from "vitest";

const tenantFetch = vi.fn();

let broken = false;
vi.mock("@platform/config", () => ({
  readWebConfig: () => {
    if (broken) throw new Error("connect ECONNREFUSED secret-host");
    return { apiUrl: "http://api.localhost:3001" };
  }
}));
vi.mock("../../panel/tenant-fetch", () => ({ tenantFetch }));

const body = JSON.stringify({ reason: "help", token: "a".repeat(64) });

describe("POST /api/waiter-calls", () => {
  beforeEach(() => {
    broken = false;
    tenantFetch.mockReset();
  });

  it("forwards the body with Host and without any authorization", async () => {
    tenantFetch.mockResolvedValue(new Response("{}", { status: 200 }));
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://bar.localhost:3100/api/waiter-calls", {
        body,
        headers: { authorization: "Bearer x", host: "bar.localhost:3100" },
        method: "POST"
      })
    );
    expect(response.status).toBe(200);
    expect(tenantFetch).toHaveBeenCalledWith(
      "http://api.localhost:3001/v1/public/waiter-calls",
      expect.objectContaining({
        body,
        headers: {
          "content-type": "application/json",
          host: "bar.localhost:3100"
        },
        method: "POST"
      })
    );
  });

  it("passes the API status through, including the frequency limit", async () => {
    tenantFetch.mockResolvedValue(
      new Response('{"error":{"code":"WAITER_CALL_RATE_LIMITED"}}', {
        status: 429
      })
    );
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://bar.localhost:3100/api/waiter-calls", {
        body,
        headers: { host: "bar.localhost:3100" },
        method: "POST"
      })
    );
    expect(response.status).toBe(429);
  });

  it("rejects oversized payloads before the API", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://bar.localhost:3100/api/waiter-calls", {
        body: "x".repeat(1_025),
        headers: { host: "bar.localhost:3100" },
        method: "POST"
      })
    );
    expect(response.status).toBe(413);
    expect(tenantFetch).not.toHaveBeenCalled();
  });

  it("answers 502 when the API cannot be reached", async () => {
    broken = true;
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://bar.localhost:3100/api/waiter-calls", {
        body,
        headers: { host: "bar.localhost:3100" },
        method: "POST"
      })
    );
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("secret-host");
  });
});
