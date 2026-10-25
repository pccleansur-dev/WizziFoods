import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException
} from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { CashRegisterController } from "./cash-register.controller.js";

const commandId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const paymentId = "33333333-3333-4333-8333-333333333333";

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

const waiter = ["tables.serve", "payments.collect", "orders.manage"];
const manager = [...waiter, "operations.approve"];
const kitchen = ["production.kitchen.manage"];

const open = { commandId, openingCashCents: 5000 };
const movement = { amountCents: 100, commandId, kind: "cash_out", reason: "x" };
const close = { commandId, countedCashCents: 100, reason: null };
const refund = {
  amountCents: 100,
  commandId,
  itemLineId: null,
  paymentId,
  reason: "x"
};

function serviceStub() {
  return {
    closeShift: vi.fn().mockResolvedValue({ closed: true }),
    getRegister: vi.fn().mockResolvedValue({ register: { open: false } }),
    openShift: vi.fn().mockResolvedValue({ shiftId: "s" }),
    recordMovement: vi.fn().mockResolvedValue({ movementId: "m" }),
    recordRefund: vi.fn().mockResolvedValue({ refundCents: 1 })
  };
}

function databaseError(code: string) {
  return Object.assign(new Error("db"), { code });
}

describe("CashRegisterController", () => {
  it("serves the register from the session context only", async () => {
    const service = serviceStub();
    const context = request(waiter);
    await expect(
      new CashRegisterController(service as never).register(context)
    ).resolves.toEqual({ data: { register: { open: false } } });
    expect(service.getRegister).toHaveBeenCalledWith(
      (context as never as { staffContext: unknown }).staffContext
    );
  });

  it("matrix: whoever collects sees the register, only the manager operates it", async () => {
    const controller = new CashRegisterController(serviceStub() as never);
    const calls: [
      string,
      (r: never) => Promise<unknown>,
      string[],
      string[]
    ][] = [
      ["view", (r) => controller.register(r), waiter, kitchen],
      ["open", (r) => controller.open(r, open), manager, waiter],
      ["movement", (r) => controller.movement(r, movement), manager, waiter],
      ["close", (r) => controller.close(r, close), manager, waiter],
      [
        "refund",
        (r) => controller.refund(r, sessionId, refund),
        manager,
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
    ["a client tenant when opening", "open", { ...open, tenantId: "t" }],
    ["a negative float", "open", { ...open, openingCashCents: -1 }],
    ["a movement without a reason", "movement", { ...movement, reason: " " }],
    [
      "an expected amount when closing",
      "close",
      { ...close, expectedCashCents: 1 }
    ],
    [
      "a card number on a refund",
      "refund",
      { ...refund, cardNumber: "4111111111111111" }
    ],
    ["a refund without a payment", "refund", { ...refund, paymentId: "nope" }]
  ])(
    "rejects %s before reaching the service",
    async (_name, operation, body) => {
      const service = serviceStub();
      const controller = new CashRegisterController(service as never);
      const context = request(manager);
      const run = {
        close: () => controller.close(context, body),
        movement: () => controller.movement(context, body),
        open: () => controller.open(context, body),
        refund: () => controller.refund(context, sessionId, body)
      }[operation as "open"];
      await expect(run()).rejects.toBeInstanceOf(BadRequestException);
      for (const mock of Object.values(service))
        expect(mock).not.toHaveBeenCalled();
    }
  );

  it("rejects a malformed session identifier", async () => {
    const service = serviceStub();
    await expect(
      new CashRegisterController(service as never).refund(
        request(manager),
        "nope",
        refund
      )
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.recordRefund).not.toHaveBeenCalled();
  });

  it("passes the route and the session to the service", async () => {
    const service = serviceStub();
    const context = request(manager);
    await new CashRegisterController(service as never).refund(
      context,
      sessionId,
      refund
    );
    expect(service.recordRefund).toHaveBeenCalledWith(
      (context as never as { staffContext: unknown }).staffContext,
      sessionId,
      refund
    );
  });

  it.each([
    ["PT100", ConflictException, "WAITER_COMMAND_REUSED"],
    ["PT200", ForbiddenException, "STAFF_FORBIDDEN"],
    ["PT201", NotFoundException, "ACCOUNT_NOT_FOUND"],
    ["PT212", BadRequestException, "INVALID_CASH_REGISTER_REQUEST"],
    ["PT222", ForbiddenException, "MANAGER_REQUIRED"],
    ["PT240", ConflictException, "CASH_REGISTER_CLOSED"],
    ["PT241", ConflictException, "CASH_REGISTER_ALREADY_OPEN"],
    ["PT242", ConflictException, "REFUND_EXCEEDS_LIMIT"]
  ])(
    "maps %s to %s without echoing database detail",
    async (code, expected, name) => {
      const service = serviceStub();
      service.openShift.mockRejectedValue(databaseError(code));
      const failure = await new CashRegisterController(service as never)
        .open(request(manager), open)
        .catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(expected);
      const body = JSON.stringify(
        (failure as Error & { response: unknown }).response
      );
      expect(body).toContain(name);
      expect(body).not.toContain('"db"');
    }
  );

  it("rethrows unknown failures", async () => {
    const service = serviceStub();
    service.getRegister.mockRejectedValue(new Error("boom"));
    await expect(
      new CashRegisterController(service as never).register(request(waiter))
    ).rejects.toThrow("boom");
  });
});
