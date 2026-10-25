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

function request(body: string, host = "bar.localhost:3100") {
  return new Request("http://bar.localhost:3100/api/account-splits/view", {
    body,
    headers: host ? { host } : {},
    method: "POST"
  });
}

describe("split proxy", () => {
  beforeEach(() => {
    broken = false;
    tenantFetch.mockReset();
  });

  it("forwards each action with the host and never with authorization", async () => {
    tenantFetch.mockImplementation(() =>
      Promise.resolve(new Response("{}", { status: 200 }))
    );
    const { POST: view } = await import("./view/route");
    const { POST: claim } = await import("./claim/route");
    const { POST: release } = await import("./release/route");
    for (const [handler, action] of [
      [view, "view"],
      [claim, "claim"],
      [release, "release"]
    ] as const) {
      const response = await handler(request("{}"));
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(tenantFetch).toHaveBeenLastCalledWith(
        `http://api.localhost:3001/v1/public/account-splits/${action}`,
        expect.objectContaining({
          headers: {
            "content-type": "application/json",
            host: "bar.localhost:3100"
          },
          method: "POST"
        })
      );
    }
  });

  it("refuses requests without a host or with a large body, and hides upstream failures", async () => {
    const { POST } = await import("./view/route");
    expect((await POST(request("{}", ""))).status).toBe(404);
    expect((await POST(request("x".repeat(4_097)))).status).toBe(413);
    expect(tenantFetch).not.toHaveBeenCalled();
    broken = true;
    const failed = await POST(request("{}"));
    expect(failed.status).toBe(502);
    expect(await failed.text()).not.toContain("secret-host");
  });
});
