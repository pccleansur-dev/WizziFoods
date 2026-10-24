import { describe, expect, it, vi } from "vitest";

import { ProductionService } from "./production.service.js";

const context = {
  capabilities: ["production.kitchen.manage" as const],
  role: "kitchen" as const,
  scope: { locationId: "location", tenantId: "tenant" },
  staffId: "staff"
};

describe("ProductionService", () => {
  it("passes only the session scope and staff id to the repository", async () => {
    const repository = {
      advanceItem: vi.fn().mockResolvedValue("advanced"),
      getBoard: vi.fn().mockResolvedValue("board")
    };
    const service = new ProductionService(repository as never);
    const request = { commandId: "c", status: "ready" } as never;
    await expect(service.getBoard(context)).resolves.toBe("board");
    await expect(
      service.advanceItem(context, "order", "line", request)
    ).resolves.toBe("advanced");
    expect(repository.getBoard).toHaveBeenCalledWith({
      scope: context.scope,
      staffId: "staff"
    });
    expect(repository.advanceItem).toHaveBeenCalledWith({
      lineId: "line",
      orderId: "order",
      request,
      scope: context.scope,
      staffId: "staff"
    });
  });
});
