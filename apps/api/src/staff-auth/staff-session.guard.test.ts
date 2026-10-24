import { UnauthorizedException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { StaffSessionGuard } from "./staff-session.guard.js";

const token = "A".repeat(43);

function contextFor(request: Record<string, unknown>) {
  return { switchToHttp: () => ({ getRequest: () => request }) } as never;
}

const session = {
  expiresAt: "2026-10-24T20:00:00.000Z",
  identity: {
    location: { id: "location", name: "Centro" },
    staff: {
      capabilities: ["tables.serve"],
      displayName: "Ana",
      id: "staff",
      role: "waiter"
    },
    tenant: { id: "tenant", name: "Bar", slug: "bar" }
  },
  lastRevalidatedAt: "2026-10-24T12:00:00.000Z"
};

describe("StaffSessionGuard", () => {
  it("derives identity, scope and capabilities only from the Bearer session", async () => {
    const service = { currentSession: vi.fn().mockResolvedValue(session) };
    const request = {
      body: { staffId: "forged", tenantId: "forged" },
      headers: { authorization: `Bearer ${token}`, "x-tenant-id": "forged" }
    } as Record<string, unknown>;
    await expect(
      new StaffSessionGuard(service as never).canActivate(contextFor(request))
    ).resolves.toBe(true);
    expect(service.currentSession).toHaveBeenCalledWith(token);
    expect(request.staffContext).toEqual({
      capabilities: ["tables.serve"],
      role: "waiter",
      scope: { locationId: "location", tenantId: "tenant" },
      staffId: "staff"
    });
  });

  it("rejects a missing or malformed Bearer without touching the database", async () => {
    const service = { currentSession: vi.fn() };
    const guard = new StaffSessionGuard(service as never);
    await expect(
      guard.canActivate(contextFor({ headers: {} }))
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      guard.canActivate(contextFor({ headers: { authorization: "Bearer x" } }))
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(service.currentSession).not.toHaveBeenCalled();
  });

  it("propagates an expired or revoked session", async () => {
    const service = {
      currentSession: vi.fn().mockRejectedValue(new UnauthorizedException())
    };
    await expect(
      new StaffSessionGuard(service as never).canActivate(
        contextFor({ headers: { authorization: `Bearer ${token}` } })
      )
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
