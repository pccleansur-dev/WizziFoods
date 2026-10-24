import { beforeEach, describe, expect, it, vi } from "vitest";

const adminApi = vi.fn();
vi.mock("./admin-api", () => ({
  adminApi: (...args: unknown[]) => adminApi(...args),
  dataOf: (body: { data?: unknown }) => body?.data
}));

const { translateCatalogAction } = await import("./translate-actions");

const id = "a1000000-0000-4000-8000-000000000001";
const request = {
  sourceLanguage: "es",
  targetLanguage: "en",
  texts: [{ key: `product:${id}:title`, text: "Milanesa" }]
};

describe("translateCatalogAction", () => {
  beforeEach(() => adminApi.mockReset());

  it("rejects invalid input before calling the API", async () => {
    const state = await translateCatalogAction({
      ...request,
      tenantId: "x"
    } as never);
    expect(state.status).toBe("error");
    expect(adminApi).not.toHaveBeenCalled();
  });

  it("sends only the keyed texts and returns the translations", async () => {
    adminApi.mockResolvedValue({
      body: {
        data: {
          translations: [{ key: `product:${id}:title`, text: "Milanese" }]
        }
      },
      ok: true,
      status: 200
    });
    const state = await translateCatalogAction(request);
    expect(adminApi).toHaveBeenCalledWith("/v1/tenant/catalog/translations", {
      body: request,
      method: "POST"
    });
    expect(state).toMatchObject({
      status: "ok",
      translations: [{ key: `product:${id}:title`, text: "Milanese" }]
    });
  });

  it("explains when the provider is not configured", async () => {
    adminApi.mockResolvedValue({
      code: "TRANSLATION_UNAVAILABLE",
      message: "La traducción automática no está configurada en este entorno.",
      ok: false,
      status: 503
    });
    const state = await translateCatalogAction(request);
    expect(state.status).toBe("unavailable");
    expect(state.message).toContain("no está configurada");
  });

  it("handles an expired session and a malformed answer", async () => {
    adminApi.mockResolvedValueOnce({
      code: "SESSION_EXPIRED",
      message: null,
      ok: false,
      status: 401
    });
    expect((await translateCatalogAction(request)).message).toContain("sesión");
    adminApi.mockResolvedValueOnce({
      body: { data: { translations: "nope" } },
      ok: true,
      status: 200
    });
    expect((await translateCatalogAction(request)).status).toBe("error");
  });
});
