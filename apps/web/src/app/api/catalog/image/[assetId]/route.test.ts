import { beforeEach, describe, expect, it, vi } from "vitest";

const tenantFetch = vi.fn();
vi.mock("../../../../panel/tenant-fetch", () => ({
  tenantFetch: (...args: unknown[]) => tenantFetch(...args)
}));

import { GET } from "./route";

const asset = "3e100000-0000-4000-8000-0000000000a1";
const call = (assetId: string) =>
  GET(
    new Request(`http://x/api/catalog/image/${assetId}`, {
      headers: { host: "demo.plataforma.test" }
    }),
    { params: Promise.resolve({ assetId }) }
  );

beforeEach(() => {
  tenantFetch.mockReset();
  vi.stubEnv("APP_ENV", "test");
  vi.stubEnv("LOG_LEVEL", "error");
  vi.stubEnv("NEXT_PUBLIC_API_URL", "http://api.test");
  vi.stubEnv("WEB_METRICS_PORT", "9465");
});

describe("GET /api/catalog/image/[assetId]", () => {
  it("forwards the host and the photo id, and returns a cacheable image", async () => {
    tenantFetch.mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "image/webp" }
      })
    );
    const response = await call(asset);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("cache-control")).toContain("max-age");
    const [url, init] = tenantFetch.mock.calls[0]!;
    expect(String(url)).toContain(`/v1/public/catalog/images/${asset}`);
    expect(init.headers).toEqual({ host: "demo.plataforma.test" });
  });

  it("is a 404 for a bad id, a missing photo, a non-image answer or a failure", async () => {
    expect((await call("../x")).status).toBe(404);
    expect(tenantFetch).not.toHaveBeenCalled();
    tenantFetch.mockResolvedValue(new Response(null, { status: 404 }));
    expect((await call(asset)).status).toBe(404);
    tenantFetch.mockResolvedValue(
      new Response("<html>", { headers: { "content-type": "text/html" } })
    );
    expect((await call(asset)).status).toBe(404);
    tenantFetch.mockRejectedValue(new Error("down"));
    expect((await call(asset)).status).toBe(404);
  });
});
