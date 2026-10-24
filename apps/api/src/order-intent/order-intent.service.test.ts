import { describe, expect, it, vi } from "vitest";

import { OrderIntentService } from "./order-intent.service.js";

const context = {
  location: { id: "location" },
  tenant: { id: "tenant" }
} as never;
const request = { commandId: crypto.randomUUID() } as never;

describe("OrderIntentService", () => {
  it("creates and lists choices inside the host-derived scope", async () => {
    const repository = {
      create: vi.fn().mockResolvedValue({ intentId: "intent" }),
      listPaymentMethods: vi.fn().mockResolvedValue([{ method: "cash" }])
    };
    const service = new OrderIntentService(repository as never);
    await expect(service.create(context, request)).resolves.toEqual({
      intentId: "intent"
    });
    await expect(service.listPaymentMethods(context)).resolves.toEqual([
      { method: "cash" }
    ]);
    expect(repository.create).toHaveBeenCalledWith({
      request,
      scope: { locationId: "location", tenantId: "tenant" }
    });
  });
});
