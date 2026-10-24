import { describe, expect, it, vi } from "vitest";

import { FloorPlanService } from "./floor-plan.service.js";

const tableId = "a2000000-0000-4000-8000-000000000002";
const token = "cd".repeat(32);
const context = {
  domain: { hostname: "bar-uno.example.com", id: "d" },
  identity: {
    assuranceLevel: "aal2",
    userId: "a1000000-0000-4000-8000-000000000001"
  },
  location: { id: "a8000000-0000-4000-8000-000000000008", name: "Bar" },
  role: "admin",
  scope: {
    locationId: "a8000000-0000-4000-8000-000000000008",
    tenantId: "a3000000-0000-4000-8000-000000000003"
  },
  tenant: { id: "a3000000-0000-4000-8000-000000000003", name: "Bar", slug: "b" }
} as never;

function repository(overrides: Record<string, unknown> = {}) {
  return {
    getPlan: vi.fn(),
    getReadiness: vi.fn(),
    listQrCodes: vi.fn(),
    resolveQr: vi.fn(),
    rotateQr: vi.fn(),
    savePlan: vi.fn(),
    ...overrides
  };
}

describe("FloorPlanService", () => {
  it("reads and saves only inside the scope and user resolved by the guards", async () => {
    const repo = repository({
      getPlan: vi.fn().mockResolvedValue({ plan: {}, version: 1 }),
      savePlan: vi.fn().mockResolvedValue({ applied: true })
    });
    const service = new FloorPlanService(repo as never);
    const command = { commandId: "c", expectedVersion: 1, plan: {} } as never;

    await service.getPlan(context);
    await service.savePlan(context, command);

    expect(repo.getPlan).toHaveBeenCalledWith(
      (context as never as { scope: unknown }).scope,
      "a1000000-0000-4000-8000-000000000001"
    );
    expect(repo.savePlan).toHaveBeenCalledWith({
      command,
      requesterId: "a1000000-0000-4000-8000-000000000001",
      scope: (context as never as { scope: unknown }).scope
    });
  });

  it("renders a downloadable SVG that encodes an opaque tenant host URL", async () => {
    const repo = repository({
      listQrCodes: vi.fn().mockResolvedValue([{ label: "1", tableId, token }])
    });
    const [qr] = await new FloorPlanService(repo as never).listQrCodes(context);

    expect(qr).toMatchObject({ label: "1", tableId });
    expect(qr?.url).toBe(`https://bar-uno.example.com/m/${token}`);
    expect(qr?.svg.startsWith("<svg")).toBe(true);
    expect(qr?.svg).not.toContain(token);
    expect(qr?.url).not.toContain(tableId);
    expect(qr?.url).not.toContain("a3000000");
  });

  it("uses http for local development hosts only", async () => {
    const repo = repository({
      listQrCodes: vi.fn().mockResolvedValue([{ label: "1", tableId, token }])
    });
    const local = {
      ...(context as object),
      domain: { hostname: "demo.localhost", id: "d" }
    } as never;
    const [qr] = await new FloorPlanService(repo as never).listQrCodes(local);
    expect(qr?.url).toBe(`http://demo.localhost/m/${token}`);
  });

  it("verifies a token against the host scope and hides everything else", async () => {
    const resolveQr = vi
      .fn()
      .mockResolvedValueOnce({
        group: null,
        label: "1",
        sectorName: "Salón",
        tableId
      })
      .mockResolvedValueOnce(null);
    const service = new FloorPlanService(repository({ resolveQr }) as never);

    await expect(service.verifyQr(context, token)).resolves.toEqual({
      table: { group: null, label: "1", sectorName: "Salón", tableId },
      valid: true
    });
    await expect(service.verifyQr(context, token)).resolves.toEqual({
      valid: false
    });
    expect(resolveQr).toHaveBeenCalledWith(
      (context as never as { scope: unknown }).scope,
      token
    );
  });
});
