import { parseReadinessReport } from "@platform/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const adminApi = vi.fn();
vi.mock("../admin-api", () => ({
  adminApi: (...args: unknown[]) => adminApi(...args),
  dataOf: (body: { data?: unknown }) => body?.data
}));

const { readinessCommandAction } = await import("./actions");

// Lo que responde la API: la matriz ya calculada, no el formato de la base.
const raw = {
  blockers: [],
  published: null,
  team: { activeManagers: 0, activeMembers: 0 },
  warnings: ["TEAM_EMPTY"]
};
const view = (extra: Record<string, unknown> = {}) =>
  JSON.parse(JSON.stringify(parseReadinessReport({ ...raw, ...extra })));
const missing = view({ blockers: ["FLOOR_NO_TABLES"] });
const run = {
  namespace: "sandbox",
  reference: "SBX-ABCD1234",
  runId: "f3000000-0000-4000-8000-000000000003",
  steps: [
    "qr_scanned",
    "order_placed",
    "in_production",
    "payment_recorded",
    "closed",
    "cleaned_up"
  ].map((step) => ({ ok: true, step }))
};

describe("readinessCommandAction", () => {
  beforeEach(() => adminApi.mockReset());

  it("rejects unknown commands without calling the API", async () => {
    const state = await readinessCommandAction("delete-everything" as never);
    expect(state.status).toBe("error");
    expect(adminApi).not.toHaveBeenCalled();
  });

  it("publishes with an empty body and returns the matrix", async () => {
    adminApi.mockResolvedValue({
      body: {
        data: view({
          published: {
            at: "2026-10-24T10:00:00+00:00",
            by: "f3000000-0000-4000-8000-000000000003",
            revision: 1
          }
        })
      },
      ok: true,
      status: 200
    });
    const state = await readinessCommandAction("publish");
    expect(adminApi).toHaveBeenCalledWith("/v1/tenant/publication", {
      body: {},
      method: "POST"
    });
    expect(state.status).toBe("saved");
    expect(state.readiness?.published?.revision).toBe(1);
  });

  it("shows the missing requirements returned with a 409", async () => {
    adminApi.mockResolvedValue({
      code: "BUSINESS_NOT_READY",
      message: "Todavía faltan requisitos.",
      ok: false,
      readiness: missing,
      status: 409
    });
    const state = await readinessCommandAction("publish");
    expect(state.status).toBe("invalid");
    expect(state.readiness?.items[0]?.code).toBe("FLOOR_NO_TABLES");
  });

  it("runs the sandbox and keeps the run in its own namespace", async () => {
    adminApi.mockResolvedValue({ body: { data: run }, ok: true, status: 200 });
    const state = await readinessCommandAction("simulate");
    expect(adminApi).toHaveBeenCalledWith("/v1/tenant/sandbox/runs", {
      body: {},
      method: "POST"
    });
    expect(state.run?.namespace).toBe("sandbox");
    expect(state.status).toBe("saved");
  });

  it("explains missing prerequisites and handles an expired session", async () => {
    adminApi.mockResolvedValueOnce({
      code: "SANDBOX_PREREQUISITES_MISSING",
      message: "Hace falta una mesa con QR.",
      ok: false,
      status: 422
    });
    expect((await readinessCommandAction("simulate")).status).toBe("invalid");
    adminApi.mockResolvedValueOnce({
      code: "SESSION_EXPIRED",
      message: null,
      ok: false,
      status: 401
    });
    expect((await readinessCommandAction("publish")).message).toContain(
      "sesión"
    );
  });

  it("cleans simulated leftovers", async () => {
    adminApi.mockResolvedValue({
      body: { data: { removed: 2 } },
      ok: true,
      status: 200
    });
    const state = await readinessCommandAction("cleanup");
    expect(adminApi).toHaveBeenCalledWith("/v1/tenant/sandbox", {
      method: "DELETE"
    });
    expect(state.message).toContain("2");
  });
});
