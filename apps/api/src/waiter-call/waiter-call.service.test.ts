import { describe, expect, it, vi } from "vitest";

import { WaiterCallService } from "./waiter-call.service.js";

describe("WaiterCallService", () => {
  it("scopes the call to the tenant and location of the host", async () => {
    const repository = { create: vi.fn().mockResolvedValue({ callId: "c" }) };
    const request = { reason: "help" as const, token: "a".repeat(64) };
    await expect(
      new WaiterCallService(repository).create(
        { location: { id: "l" }, tenant: { id: "t" } } as never,
        request
      )
    ).resolves.toEqual({ callId: "c" });
    expect(repository.create).toHaveBeenCalledWith({
      request,
      scope: { locationId: "l", tenantId: "t" }
    });
  });
});
