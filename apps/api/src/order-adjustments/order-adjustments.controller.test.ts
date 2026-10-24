import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException
} from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { OrderAdjustmentsController } from "./order-adjustments.controller.js";

const commandId = "11111111-1111-4111-8111-111111111111";
const orderId = "22222222-2222-4222-8222-222222222222";
const lineId = "33333333-3333-4333-8333-333333333333";
const productId = "44444444-4444-4444-8444-444444444444";
const adjustmentId = "55555555-5555-4555-8555-555555555555";

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

const waiter = [
  "tables.serve",
  "orders.manage",
  "orders.validate",
  "calls.manage"
];
const manager = [...waiter, "operations.approve"];
const kitchen = ["production.kitchen.manage"];

function serviceStub() {
  return {
    cancelItem: vi.fn().mockResolvedValue({ status: "cancelled" }),
    decideReplacement: vi.fn().mockResolvedValue({ status: "accepted" }),
    deliverItem: vi.fn().mockResolvedValue({ status: "delivered" }),
    getOrders: vi.fn().mockResolvedValue({ orders: [] }),
    proposeReplacement: vi.fn().mockResolvedValue({ status: "proposed" }),
    reportException: vi.fn().mockResolvedValue({ status: "exception" })
  };
}

function databaseError(code: string) {
  return Object.assign(new Error("db"), { code });
}

describe("OrderAdjustmentsController", () => {
  it("serves the orders in progress from the session context only", async () => {
    const service = serviceStub();
    const context = request(waiter);
    await expect(
      new OrderAdjustmentsController(service as never).orders(context)
    ).resolves.toEqual({ data: { orders: [] } });
    expect(service.getOrders).toHaveBeenCalledWith(
      (context as never as { staffContext: unknown }).staffContext
    );
  });

  it("matrix: every operation is limited to the roles that own it", async () => {
    const controller = new OrderAdjustmentsController(serviceStub() as never);
    const calls: [
      string,
      (r: never) => Promise<unknown>,
      string[],
      string[]
    ][] = [
      ["orders", (r) => controller.orders(r), waiter, kitchen],
      [
        "deliver",
        (r) => controller.deliver(r, orderId, lineId, { commandId }),
        waiter,
        kitchen
      ],
      [
        "propose",
        (r) =>
          controller.propose(r, orderId, lineId, {
            commandId,
            productId,
            variantId: null
          }),
        waiter,
        kitchen
      ],
      [
        "decide",
        (r) =>
          controller.decide(r, adjustmentId, {
            commandId,
            decision: "accept",
            reason: null
          }),
        waiter,
        kitchen
      ],
      [
        "cancel",
        (r) =>
          controller.cancel(r, orderId, lineId, { commandId, reason: "x" }),
        manager,
        waiter
      ],
      [
        "exception",
        (r) =>
          controller.reportException(r, orderId, lineId, {
            commandId,
            reason: "x"
          }),
        kitchen,
        waiter
      ]
    ];
    for (const [name, call, allowed, denied] of calls) {
      await expect(
        call(request(allowed) as never),
        name
      ).resolves.toBeDefined();
      await expect(call(request(denied) as never), name).rejects.toBeInstanceOf(
        ForbiddenException
      );
      await expect(call(request([]) as never), name).rejects.toBeInstanceOf(
        ForbiddenException
      );
    }
  });

  it.each([
    ["a client tenant on a delivery", "deliver", { commandId, tenantId: "t" }],
    [
      "a price on a replacement",
      "propose",
      { commandId, productId, variantId: null, priceCents: 1 }
    ],
    ["a missing reason on a cancellation", "cancel", { commandId }],
    [
      "a rejection without a reason",
      "decide",
      { commandId, decision: "reject", reason: null }
    ],
    ["a shortage without a reason", "exception", { commandId, reason: "  " }]
  ])(
    "rejects %s before reaching the service",
    async (_name, operation, body) => {
      const service = serviceStub();
      const controller = new OrderAdjustmentsController(service as never);
      const context = request([...manager, ...kitchen]);
      const run = {
        cancel: () => controller.cancel(context, orderId, lineId, body),
        decide: () => controller.decide(context, adjustmentId, body),
        deliver: () => controller.deliver(context, orderId, lineId, body),
        exception: () =>
          controller.reportException(context, orderId, lineId, body),
        propose: () => controller.propose(context, orderId, lineId, body)
      }[operation as "cancel"];
      await expect(run()).rejects.toBeInstanceOf(BadRequestException);
      for (const mock of Object.values(service))
        expect(mock).not.toHaveBeenCalled();
    }
  );

  it("rejects malformed route identifiers", async () => {
    const service = serviceStub();
    const controller = new OrderAdjustmentsController(service as never);
    await expect(
      controller.deliver(request(waiter), "nope", lineId, { commandId })
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.decide(request(waiter), "nope", {
        commandId,
        decision: "accept",
        reason: null
      })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.deliverItem).not.toHaveBeenCalled();
  });

  it("passes the route and the session to the service", async () => {
    const service = serviceStub();
    const context = request(manager);
    const controller = new OrderAdjustmentsController(service as never);
    await controller.cancel(context, orderId, lineId, {
      commandId,
      reason: "Sin stock"
    });
    expect(service.cancelItem).toHaveBeenCalledWith(
      (context as never as { staffContext: unknown }).staffContext,
      orderId,
      lineId,
      { commandId, reason: "Sin stock" }
    );
  });

  it.each([
    ["PT100", ConflictException],
    ["PT200", ForbiddenException],
    ["PT201", NotFoundException],
    ["PT206", ConflictException],
    ["PT211", ConflictException],
    ["PT104", ConflictException],
    ["PT212", BadRequestException],
    ["PT220", ConflictException],
    ["PT221", ConflictException],
    ["PT222", ForbiddenException],
    ["PT224", ConflictException]
  ])("maps %s without echoing database detail", async (code, expected) => {
    const service = serviceStub();
    service.deliverItem.mockRejectedValue(databaseError(code));
    const failure = await new OrderAdjustmentsController(service as never)
      .deliver(request(waiter), orderId, lineId, { commandId })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(expected);
    expect(
      JSON.stringify((failure as Error & { response: unknown }).response)
    ).not.toContain("db");
  });

  it("rethrows unknown failures", async () => {
    const service = serviceStub();
    service.getOrders.mockRejectedValue(new Error("boom"));
    await expect(
      new OrderAdjustmentsController(service as never).orders(request(waiter))
    ).rejects.toThrow("boom");
  });
});
