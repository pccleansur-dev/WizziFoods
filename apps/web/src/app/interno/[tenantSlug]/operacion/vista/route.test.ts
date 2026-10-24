import { beforeEach, describe, expect, it, vi } from "vitest";

const callStaffApi = vi.fn();
vi.mock("../../../../../staff/waiter-api", () => ({ callStaffApi }));

const params = Promise.resolve({ tenantSlug: "bar" });
const view = {
  calls: [],
  floors: [],
  generatedAt: "2026-10-24T12:00:00.000Z",
  intents: [],
  units: []
};

describe("GET /interno/[tenantSlug]/operacion/vista", () => {
  beforeEach(() => callStaffApi.mockReset());

  it("returns the validated view without caching", async () => {
    callStaffApi.mockResolvedValue({
      body: { data: view },
      ok: true,
      status: 200
    });
    const { GET } = await import("./route");
    const response = await GET(new Request("http://bar.test"), { params });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual(view);
    expect(callStaffApi).toHaveBeenCalledWith("bar", "GET", "/v1/staff/salon");
  });

  it("answers 401 when the session cookie is missing or expired", async () => {
    const { GET } = await import("./route");
    callStaffApi.mockResolvedValue({ sessionMissing: true });
    expect((await GET(new Request("http://bar.test"), { params })).status).toBe(
      401
    );
    callStaffApi.mockResolvedValue({ body: null, ok: false, status: 401 });
    expect((await GET(new Request("http://bar.test"), { params })).status).toBe(
      401
    );
  });

  it("never forwards an unvalidated API answer", async () => {
    callStaffApi.mockResolvedValue({
      body: { data: { ...view, tenantId: "x" } },
      ok: true,
      status: 200
    });
    const { GET } = await import("./route");
    expect((await GET(new Request("http://bar.test"), { params })).status).toBe(
      502
    );
  });
});
