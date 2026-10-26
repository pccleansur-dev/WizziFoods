import { beforeEach, describe, expect, it, vi } from "vitest";

const tenantFetch = vi.fn();

vi.mock("@platform/config", () => ({
  readWebConfig: () => ({
    apiUrl: "http://api.localhost:3001",
    environment: "test"
  })
}));
vi.mock("../../panel/tenant-fetch", () => ({ tenantFetch }));
vi.mock("../../../app/panel/tenant-fetch", () => ({ tenantFetch }));

const host = "bar.localhost:3100";
const token = "T".repeat(43);

function request(
  init: {
    cookie?: string;
    method?: string;
    origin?: string;
    body?: string;
  } = {}
) {
  const headers: Record<string, string> = { host };
  if (init.cookie) headers.cookie = init.cookie;
  if (init.origin) headers.origin = init.origin;
  return new Request(`http://${host}/api/diner/me`, {
    ...(init.body === undefined ? {} : { body: init.body }),
    headers,
    method: init.method ?? "GET"
  });
}

describe("localPath", () => {
  it("keeps paths on the same host and drops everything else", async () => {
    const { localPath } = await import("./diner-proxy");
    expect(localPath("/m/abc?x=1")).toBe("/m/abc?x=1");
    for (const bad of [
      "//evil.test",
      "https://evil.test",
      "/\\evil.test",
      "evil",
      null,
      ""
    ]) {
      expect(localPath(bad)).toBe("/");
    }
  });
});

describe("diner proxy", () => {
  beforeEach(() => {
    tenantFetch.mockReset();
  });

  it("sends the session cookie as a Bearer token with the real host and nothing else", async () => {
    tenantFetch.mockResolvedValue(new Response("{}", { status: 200 }));
    const { proxyDiner, sessionCookie } = await import("./diner-proxy");
    const response = await proxyDiner(
      request({ cookie: `${sessionCookie}=${token}` }),
      { method: "GET", path: "/v1/public/diner/me" }
    );
    expect(response.status).toBe(200);
    const [url, init] = tenantFetch.mock.calls[0] as [
      string,
      { headers: Record<string, string> }
    ];
    expect(url).toBe("http://api.localhost:3001/v1/public/diner/me");
    // No body, no content type: the API rejects an empty body declared as JSON.
    expect(init.headers).toEqual({ authorization: `Bearer ${token}`, host });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("answers 401 without a cookie and never calls the API", async () => {
    const { proxyDiner } = await import("./diner-proxy");
    const response = await proxyDiner(request(), {
      method: "GET",
      path: "/v1/public/diner/me"
    });
    expect(response.status).toBe(401);
    expect(tenantFetch).not.toHaveBeenCalled();
  });

  it("refuses a state-changing call from another origin", async () => {
    const { proxyDiner, sessionCookie } = await import("./diner-proxy");
    for (const origin of [undefined, "http://evil.test"]) {
      const response = await proxyDiner(
        request({
          body: "{}",
          cookie: `${sessionCookie}=${token}`,
          method: "PUT",
          ...(origin ? { origin } : {})
        }),
        { method: "PUT", path: "/v1/public/diner/profile" }
      );
      expect(response.status).toBe(403);
    }
    expect(tenantFetch).not.toHaveBeenCalled();
  });

  it("trusts Sec-Fetch-Site over an Origin of null (pages that send no referrer)", async () => {
    tenantFetch.mockResolvedValue(new Response("{}", { status: 200 }));
    const { isOwnSite, sessionCookie } = await import("./diner-proxy");
    const base = { "content-type": "application/json", host };
    const with_ = (extra: Record<string, string>) =>
      new Request(`http://${host}/api/diner/profile`, {
        body: "{}",
        headers: { ...base, ...extra, cookie: `${sessionCookie}=${token}` },
        method: "PUT"
      });
    expect(
      isOwnSite(with_({ origin: "null", "sec-fetch-site": "same-origin" }))
    ).toBe(true);
    expect(
      isOwnSite(
        with_({ origin: `http://${host}`, "sec-fetch-site": "cross-site" })
      )
    ).toBe(false);
    expect(isOwnSite(with_({ "sec-fetch-site": "same-site" }))).toBe(false);
    expect(isOwnSite(with_({ origin: `http://${host}` }))).toBe(true);
    expect(isOwnSite(with_({ origin: "http://evil.test" }))).toBe(false);
  });

  it("forgets a session the API rejects", async () => {
    tenantFetch.mockResolvedValue(new Response("{}", { status: 401 }));
    const { proxyDiner, sessionCookie } = await import("./diner-proxy");
    const response = await proxyDiner(
      request({ cookie: `${sessionCookie}=${token}` }),
      { method: "GET", path: "/v1/public/diner/me" }
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("does not leak connection errors", async () => {
    tenantFetch.mockRejectedValue(new Error("connect ECONNREFUSED secret"));
    const { proxyDiner, sessionCookie } = await import("./diner-proxy");
    const response = await proxyDiner(
      request({ cookie: `${sessionCookie}=${token}` }),
      { method: "GET", path: "/v1/public/diner/me" }
    );
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("secret");
  });

  it("scopes cookies to the host, HttpOnly and Lax", async () => {
    const { sessionCookieHeader, bindingCookieHeader } =
      await import("./diner-proxy");
    for (const header of [
      sessionCookieHeader(token),
      bindingCookieHeader(token)
    ]) {
      expect(header).toContain("HttpOnly");
      expect(header).toContain("SameSite=Lax");
      expect(header).not.toContain("Domain=");
    }
  });
});
