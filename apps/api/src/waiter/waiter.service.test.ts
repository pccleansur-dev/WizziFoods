import { describe, expect, it, vi } from "vitest";

import { WaiterService } from "./waiter.service.js";

const context = {
  capabilities: [],
  role: "waiter" as const,
  scope: { locationId: "location", tenantId: "tenant" },
  staffId: "staff"
};

describe("WaiterService", () => {
  it("passes the session scope and staff id to every repository call", async () => {
    const operations = {
      claimCall: vi.fn().mockResolvedValue("claim"),
      createManualOrder: vi.fn().mockResolvedValue("order"),
      decideIntent: vi.fn().mockResolvedValue("decision"),
      getSalon: vi.fn().mockResolvedValue("salon")
    };
    const catalog = { getCurrent: vi.fn().mockResolvedValue("menu") };
    const service = new WaiterService(operations as never, catalog as never);
    const request = { commandId: "c" } as never;
    await service.getSalon(context);
    await service.claimCall(context, "call", request);
    await service.decideIntent(context, "intent", request);
    await service.createManualOrder(context, request);
    await expect(service.getMenu(context)).resolves.toBe("menu");
    const expected = { scope: context.scope, staffId: "staff" };
    expect(operations.getSalon).toHaveBeenCalledWith(expected);
    expect(operations.claimCall).toHaveBeenCalledWith({
      ...expected,
      callId: "call",
      request
    });
    expect(operations.decideIntent).toHaveBeenCalledWith({
      ...expected,
      intentId: "intent",
      request
    });
    expect(operations.createManualOrder).toHaveBeenCalledWith({
      ...expected,
      request
    });
    expect(catalog.getCurrent).toHaveBeenCalledWith(context.scope);
  });
});
