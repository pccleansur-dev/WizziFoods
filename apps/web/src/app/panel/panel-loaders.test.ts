import { beforeEach, describe, expect, it, vi } from "vitest";

const tenantFetch = vi.fn();
vi.mock("./tenant-fetch", () => ({
  tenantFetch: (...args: unknown[]) => tenantFetch(...args)
}));
vi.mock("../../auth/supabase-server", () => ({
  createAuthServerClient: () =>
    Promise.resolve({
      auth: {
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

const { loadBusinessProfileDraft } = await import("./business-profile");
const { loadCatalogDraft, loadPublishedCatalog } = await import("./catalog");
const { loadCatalogImports } = await import("./catalog-import");

const host = "demo.localhost:3000";

// `fetch` de Node descarta `Host`: la API respondería 404 y la pantalla vería
// vacío lo que sí está guardado.
describe("panel loaders send the tenant Host", () => {
  beforeEach(() => {
    tenantFetch.mockReset();
    tenantFetch.mockResolvedValue(new Response("{}", { status: 404 }));
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("fetch drops the Host header");
      })
    );
  });

  it.each([
    [
      "business profile",
      () => loadBusinessProfileDraft(host),
      "business-profile"
    ],
    ["catalog draft", () => loadCatalogDraft(host), "catalog/draft"],
    ["published catalog", () => loadPublishedCatalog(host), "catalog/current"],
    ["catalog imports", () => loadCatalogImports(host), "catalog-imports"]
  ])("%s", async (_name, load, path) => {
    await load();
    expect(tenantFetch).toHaveBeenCalledTimes(1);
    const [url, init] = tenantFetch.mock.calls[0] as [
      string,
      { headers: Record<string, string> }
    ];
    expect(url).toBe(`http://localhost:3001/v1/tenant/${path}`);
    expect(init.headers.host).toBe(host);
    expect(init.headers.authorization).toBe("Bearer session-token");
  });
});
