import { beforeEach, describe, expect, it, vi } from "vitest";

const tenantFetch = vi.fn();
vi.mock("../../panel/tenant-fetch", () => ({
  tenantFetch: (...args: unknown[]) => tenantFetch(...args)
}));
const uploadToSignedUrl = vi.fn();
vi.mock("../../../auth/supabase-server", () => ({
  createAuthServerClient: () =>
    Promise.resolve({
      storage: { from: () => ({ uploadToSignedUrl }) },
      auth: {
        getClaims: () =>
          Promise.resolve({ data: { claims: { aal: "aal2" } }, error: null }),
        getSession: () =>
          Promise.resolve({
            data: { session: { access_token: "session-token" } },
            error: null
          })
      }
    })
}));
vi.mock("@platform/config", () => ({
  readWebConfig: () => ({ apiUrl: "http://localhost:3001" })
}));

const { POST } = await import("./route");
const { GET } = await import("./[assetId]/route");

const hostname = "demo.localhost:3000";
const assetId = "a1000000-0000-4000-8000-000000000001";

// `fetch` de Node descarta `Host`: la API respondería TENANT_NOT_FOUND.
describe("business media routes reach the API through tenantFetch", () => {
  beforeEach(() => {
    tenantFetch.mockReset();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("fetch drops the Host header");
      })
    );
  });

  it("reserves the upload with the tenant host", async () => {
    tenantFetch.mockResolvedValue(new Response("{}", { status: 404 }));
    const form = new FormData();
    form.set("kind", "logo");
    form.set(
      "file",
      new File([new Uint8Array(8)], "logo.png", { type: "image/png" })
    );
    const response = await POST(
      new Request(`http://${hostname}/api/business-media`, {
        body: form,
        headers: { host: hostname, origin: `http://${hostname}` },
        method: "POST"
      })
    );
    expect(response.status).toBe(502);
    expect(tenantFetch).toHaveBeenCalledTimes(1);
    const [url, init] = tenantFetch.mock.calls[0] as [
      string,
      { headers: Record<string, string> }
    ];
    expect(url).toBe(
      "http://localhost:3001/v1/tenant/business-media/reservations"
    );
    expect(init.headers.host).toBe(hostname);
    expect(init.headers.authorization).toBe("Bearer session-token");
  });

  it("queues processing without a JSON content type, since it has no body", async () => {
    const assetUuid = "a2000000-0000-4000-8000-000000000002";
    const reservation = {
      data: {
        contentType: "image/png",
        expiresAt: "2026-10-24T12:00:00.000Z",
        id: assetUuid,
        kind: "logo",
        objectPath: `t/${assetUuid}.png`,
        sourceSizeBytes: 8,
        status: "reserved",
        uploadUrl:
          "http://localhost:18000/storage/v1/object/upload/sign/business-media/x?token=abc"
      }
    };
    tenantFetch
      .mockResolvedValueOnce(Response.json(reservation))
      .mockResolvedValueOnce(new Response("{}", { status: 500 }));
    uploadToSignedUrl.mockResolvedValue({ error: null });
    const form = new FormData();
    form.set("kind", "logo");
    form.set(
      "file",
      new File([new Uint8Array(8)], "logo.png", { type: "image/png" })
    );
    await POST(
      new Request(`http://${hostname}/api/business-media`, {
        body: form,
        headers: { host: hostname, origin: `http://${hostname}` },
        method: "POST"
      })
    );
    const [url, init] = tenantFetch.mock.calls[1] as [
      string,
      { body?: string; headers: Record<string, string> }
    ];
    expect(url).toContain(`/${assetUuid}/processing`);
    expect(init.body).toBeUndefined();
    expect(init.headers["content-type"]).toBeUndefined();
    expect(init.headers.host).toBe(hostname);
  });

  it("reads the asset status with the tenant host", async () => {
    tenantFetch.mockResolvedValue(new Response("{}", { status: 404 }));
    const response = await GET(
      new Request(`http://${hostname}/api/business-media/${assetId}`, {
        headers: { host: hostname }
      }),
      { params: Promise.resolve({ assetId }) }
    );
    expect(response.status).toBe(404);
    const [url, init] = tenantFetch.mock.calls[0] as [
      string,
      { headers: Record<string, string> }
    ];
    expect(url).toBe(
      `http://localhost:3001/v1/tenant/business-media/${assetId}`
    );
    expect(init.headers.host).toBe(hostname);
  });
});
