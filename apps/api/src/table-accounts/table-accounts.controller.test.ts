import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException
} from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { TableAccountsController } from "./table-accounts.controller.js";

const commandId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";

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

const payment = { amountCents: null, commandId, method: "cash", tipCents: 0 };
const discount = {
  commandId,
  kind: "percent",
  reason: "Cortesía",
  value: 1000
};

function serviceStub() {
  return {
    applyDiscount: vi.fn().mockResolvedValue({ discountCents: 1 }),
    getAccounts: vi.fn().mockResolvedValue({ accounts: [] }),
    keepOpen: vi.fn().mockResolvedValue({ decision: "keep_open" }),
    recordPayment: vi.fn().mockResolvedValue({ paymentCents: 1 })
  };
}

function databaseError(code: string) {
  return Object.assign(new Error("db"), { code });
}

describe("TableAccountsController", () => {
  it("serves the accounts from the session context only", async () => {
    const service = serviceStub();
    const context = request(waiter);
    await expect(
      new TableAccountsController(service as never).accounts(context)
    ).resolves.toEqual({ data: { accounts: [] } });
    expect(service.getAccounts).toHaveBeenCalledWith(
      (context as never as { staffContext: unknown }).staffContext
    );
  });

  it("matrix: collecting and keeping open belong to the waiter, discounts to the manager", async () => {
    const controller = new TableAccountsController(serviceStub() as never);
    const calls: [
      string,
      (r: never) => Promise<unknown>,
      string[],
      string[]
    ][] = [
      ["accounts", (r) => controller.accounts(r), waiter, kitchen],
      ["pay", (r) => controller.pay(r, sessionId, payment), waiter, kitchen],
      [
        "keep",
        (r) => controller.keepOpen(r, sessionId, { commandId }),
        waiter,
        kitchen
      ],
      [
        "discount",
        (r) => controller.discount(r, sessionId, discount),
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
    ["an online method", "pay", { ...payment, method: "mercado_pago" }],
    ["a client currency", "pay", { ...payment, currency: "USD" }],
    ["a card number", "pay", { ...payment, cardNumber: "4111111111111111" }],
    ["a negative tip", "pay", { ...payment, tipCents: -1 }],
    ["a discount without a reason", "discount", { ...discount, reason: " " }],
    ["a percentage above 100%", "discount", { ...discount, value: 10_001 }],
    ["a client total on keep-open", "keep", { commandId, totalCents: 1 }]
  ])(
    "rejects %s before reaching the service",
    async (_name, operation, body) => {
      const service = serviceStub();
      const controller = new TableAccountsController(service as never);
      const context = request(manager);
      const run = {
        discount: () => controller.discount(context, sessionId, body),
        keep: () => controller.keepOpen(context, sessionId, body),
        pay: () => controller.pay(context, sessionId, body)
      }[operation as "pay"];
      await expect(run()).rejects.toBeInstanceOf(BadRequestException);
      for (const mock of Object.values(service))
        expect(mock).not.toHaveBeenCalled();
    }
  );

  it("rejects a malformed session identifier", async () => {
    const service = serviceStub();
    await expect(
      new TableAccountsController(service as never).pay(
        request(waiter),
        "nope",
        payment
      )
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.recordPayment).not.toHaveBeenCalled();
  });

  it("passes the route and the session to the service", async () => {
    const service = serviceStub();
    const context = request(waiter);
    await new TableAccountsController(service as never).pay(
      context,
      sessionId,
      {
        amountCents: 1000,
        commandId,
        method: "cash",
        tipCents: 100
      }
    );
    expect(service.recordPayment).toHaveBeenCalledWith(
      (context as never as { staffContext: unknown }).staffContext,
      sessionId,
      { amountCents: 1000, commandId, method: "cash", tipCents: 100 }
    );
  });

  it.each([
    ["PT100", ConflictException],
    ["PT200", ForbiddenException],
    ["PT201", NotFoundException],
    ["PT212", BadRequestException],
    ["PT222", ForbiddenException],
    ["PT230", ConflictException],
    ["PT231", ConflictException],
    ["PT232", ConflictException]
  ])("maps %s without echoing database detail", async (code, expected) => {
    const service = serviceStub();
    service.recordPayment.mockRejectedValue(databaseError(code));
    const failure = await new TableAccountsController(service as never)
      .pay(request(waiter), sessionId, payment)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(expected);
    expect(
      JSON.stringify((failure as Error & { response: unknown }).response)
    ).not.toContain("db");
  });

  it("rethrows unknown failures", async () => {
    const service = serviceStub();
    service.getAccounts.mockRejectedValue(new Error("boom"));
    await expect(
      new TableAccountsController(service as never).accounts(request(waiter))
    ).rejects.toThrow("boom");
  });
});
