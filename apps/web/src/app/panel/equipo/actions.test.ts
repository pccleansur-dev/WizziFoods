import { beforeEach, describe, expect, it, vi } from "vitest";

const adminApi = vi.fn();
vi.mock("../admin-api", () => ({
  adminApi: (...args: unknown[]) => adminApi(...args),
  dataOf: (body: { data?: unknown }) => body?.data
}));

const { teamCommandAction } = await import("./actions");

const memberId = "f2000000-0000-4000-8000-000000000002";
const member = {
  createdAt: "2026-10-24T00:00:00Z",
  displayName: "Ana",
  id: memberId,
  isActive: true,
  role: "waiter",
  sectorIds: [],
  username: "ana"
};

describe("teamCommandAction", () => {
  beforeEach(() => adminApi.mockReset());

  it("validates before calling the API and never echoes the PIN", async () => {
    const result = await teamCommandAction({
      displayName: "Ana",
      pin: "12ab56",
      role: "waiter",
      sectorIds: [],
      type: "create",
      username: "ana"
    });
    expect(result.status).toBe("invalid");
    expect(adminApi).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("12ab56");
  });

  it("creates a member and returns the refreshed list without the PIN", async () => {
    adminApi
      .mockResolvedValueOnce({ body: { data: member }, ok: true, status: 201 })
      .mockResolvedValueOnce({
        body: { data: [member] },
        ok: true,
        status: 200
      });
    const result = await teamCommandAction({
      displayName: "Ana",
      pin: "123456",
      role: "waiter",
      sectorIds: [],
      type: "create",
      username: "ana"
    });
    expect(result.status).toBe("saved");
    expect(result.members).toEqual([member]);
    expect(JSON.stringify(result)).not.toContain("123456");
    expect(adminApi.mock.calls[0]![0]).toBe("/v1/tenant/team");
  });

  it("reports the API message when the last manager is protected", async () => {
    adminApi.mockResolvedValue({
      code: "TEAM_LAST_MANAGER",
      message: "Debe quedar al menos un Encargado activo.",
      ok: false,
      status: 409
    });
    const result = await teamCommandAction({
      active: false,
      id: memberId,
      type: "active"
    });
    expect(result.message).toBe("Debe quedar al menos un Encargado activo.");
    expect(result.status).toBe("error");
  });

  it("rejects malformed ids without calling the API", async () => {
    const result = await teamCommandAction({
      active: false,
      id: "x",
      type: "active"
    });
    expect(result.status).toBe("error");
    expect(adminApi).not.toHaveBeenCalled();
  });
});
