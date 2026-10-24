import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException
} from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { WaiterController } from "./waiter.controller.js";

const commandId = "11111111-1111-4111-8111-111111111111";
const callId = "22222222-2222-4222-8222-222222222222";
const intentId = "33333333-3333-4333-8333-333333333333";
const tableId = "44444444-4444-4444-8444-444444444444";
const lineId = "55555555-5555-4555-8555-555555555555";
const productId = "66666666-6666-4666-8666-666666666666";

function request(capabilities: string[]) {
  return {
    staffContext: {
      capabilities,
      role: "waiter",
      scope: { locationId: "location", tenantId: "tenant" },
      staffId: "staff"
    }
  } as never;
}

const all = [
  "calls.manage",
  "orders.manage",
  "orders.validate",
  "tables.serve"
];

function serviceStub() {
  return {
    claimCall: vi.fn().mockResolvedValue({ callId }),
    createManualOrder: vi.fn().mockResolvedValue({ orderId: "order" }),
    decideIntent: vi.fn().mockResolvedValue({ decision: "rejected" }),
    getMenu: vi.fn().mockResolvedValue(null),
    getSalon: vi.fn().mockResolvedValue({ units: [] })
  };
}

function databaseError(code: string) {
  return Object.assign(new Error("db"), { code });
}

describe("WaiterController", () => {
  it("serves the salon from the session context only", async () => {
    const service = serviceStub();
    const context = request(all);
    await expect(
      new WaiterController(service as never).salon(context)
    ).resolves.toEqual({ data: { units: [] } });
    expect(service.getSalon).toHaveBeenCalledWith(
      (context as never as { staffContext: unknown }).staffContext
    );
  });

  it("forbids roles without the capability (kitchen, bar)", async () => {
    const controller = new WaiterController(serviceStub() as never);
    await expect(
      controller.salon(request(["production.kitchen.manage"]))
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      controller.claim(request([]), callId, { commandId })
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      controller.decide(request(["calls.manage"]), intentId, {
        commandId,
        decision: "confirm",
        reason: null
      })
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("rejects forged scope or totals before reaching the service", async () => {
    const service = serviceStub();
    const controller = new WaiterController(service as never);
    await expect(
      controller.claim(request(all), callId, { commandId, tenantId: "x" })
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.decide(request(all), intentId, {
        commandId,
        decision: "confirm",
        paymentMethod: "cash",
        reason: null
      })
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.decide(request(all), intentId, {
        commandId,
        decision: "reject",
        reason: null
      })
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.createOrder(request(all), {
        attribution: "table",
        commandId,
        dinerName: null,
        items: [{ lineId, productId, quantity: 1, variantId: null }],
        seatLabel: null,
        tableId,
        totalCents: 1
      })
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.claim(request(all), "not-a-uuid", { commandId })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.claimCall).not.toHaveBeenCalled();
    expect(service.decideIntent).not.toHaveBeenCalled();
    expect(service.createManualOrder).not.toHaveBeenCalled();
  });

  it("maps database state errors without leaking details", async () => {
    const cases: [string, unknown][] = [
      ["PT200", ForbiddenException],
      ["PT201", NotFoundException],
      ["PT203", ConflictException],
      ["PT204", ConflictException],
      ["PT205", ConflictException],
      ["PT206", ConflictException],
      ["PT207", ConflictException],
      ["PT210", ConflictException],
      ["PT211", ConflictException],
      ["PT104", ConflictException],
      ["PT100", ConflictException],
      ["PT212", BadRequestException]
    ];
    for (const [code, expected] of cases) {
      const service = serviceStub();
      service.claimCall.mockRejectedValue(databaseError(code));
      await expect(
        new WaiterController(service as never).claim(request(all), callId, {
          commandId
        })
      ).rejects.toBeInstanceOf(expected as never);
    }
    const service = serviceStub();
    service.claimCall.mockRejectedValue(databaseError("XX000"));
    await expect(
      new WaiterController(service as never).claim(request(all), callId, {
        commandId
      })
    ).rejects.toThrow("db");
  });

  it("confirms with the session identity and never forwards client scope", async () => {
    const service = serviceStub();
    await new WaiterController(service as never).decide(
      request(all),
      intentId,
      { commandId, decision: "confirm", reason: null }
    );
    expect(service.decideIntent).toHaveBeenCalledWith(
      expect.objectContaining({ staffId: "staff" }),
      intentId,
      { commandId, decision: "confirm", reason: null }
    );
  });
});
