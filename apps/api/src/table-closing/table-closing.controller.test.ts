import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException
} from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { TableClosingController } from "./table-closing.controller.js";

const commandId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const tableId = "33333333-3333-4333-8333-333333333333";
const requestId = "44444444-4444-4444-8444-444444444444";

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

const waiter = ["tables.serve", "payments.collect"];
const manager = [...waiter, "operations.approve"];
const kitchen = ["production.kitchen.manage"];

function serviceStub() {
  return {
    cleanTable: vi.fn().mockResolvedValue({ state: "available" }),
    closeAccount: vi.fn().mockResolvedValue({ sessionId }),
    getClosedAccounts: vi.fn().mockResolvedValue({ accounts: [] }),
    getReceipt: vi.fn().mockResolvedValue({ number: 1 }),
    requestCashier: vi.fn().mockResolvedValue({ status: "open" }),
    resolveCashierRequest: vi.fn().mockResolvedValue({ status: "resolved" })
  };
}

function databaseError(code: string) {
  return Object.assign(new Error("db"), { code });
}

describe("TableClosingController", () => {
  it("serves the closed accounts from the session context only", async () => {
    const service = serviceStub();
    const context = request(waiter);
    await expect(
      new TableClosingController(service as never).closedAccounts(context)
    ).resolves.toEqual({ data: { accounts: [] } });
    expect(service.getClosedAccounts).toHaveBeenCalledWith(
      (context as never as { staffContext: unknown }).staffContext
    );
  });

  it("matrix: the floor staff closes, cleans and asks the cashier; the manager resolves; kitchen does nothing", async () => {
    const controller = new TableClosingController(serviceStub() as never);
    const calls: [
      string,
      (r: never) => Promise<unknown>,
      string[],
      string[]
    ][] = [
      ["closed", (r) => controller.closedAccounts(r), waiter, kitchen],
      [
        "close",
        (r) => controller.close(r, sessionId, { commandId }),
        waiter,
        kitchen
      ],
      ["receipt", (r) => controller.receipt(r, sessionId), waiter, kitchen],
      [
        "notify",
        (r) => controller.requestCashier(r, sessionId, { commandId }),
        waiter,
        kitchen
      ],
      [
        "clean",
        (r) => controller.clean(r, tableId, { commandId }),
        waiter,
        kitchen
      ],
      [
        "resolve",
        (r) => controller.resolve(r, requestId, { commandId }),
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
    ["a client total", "close", { commandId, totalCents: 0 }],
    ["a tax id", "notify", { commandId, cuit: "20-12345678-9" }],
    ["a state", "clean", { commandId, state: "available" }],
    ["no command", "close", {}]
  ])(
    "rejects %s before reaching the service",
    async (_name, operation, body) => {
      const service = serviceStub();
      const controller = new TableClosingController(service as never);
      const context = request(manager);
      const call =
        operation === "close"
          ? controller.close(context, sessionId, body)
          : operation === "notify"
            ? controller.requestCashier(context, sessionId, body)
            : controller.clean(context, tableId, body);
      await expect(call).rejects.toBeInstanceOf(BadRequestException);
      expect(service.closeAccount).not.toHaveBeenCalled();
      expect(service.requestCashier).not.toHaveBeenCalled();
      expect(service.cleanTable).not.toHaveBeenCalled();
    }
  );

  it("rejects an identifier that is not a UUID", async () => {
    const controller = new TableClosingController(serviceStub() as never);
    await expect(
      controller.close(request(waiter), "not-a-uuid", { commandId })
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.receipt(request(waiter), "not-a-uuid")
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([
    ["PT100", ConflictException, "WAITER_COMMAND_REUSED"],
    ["PT201", NotFoundException, "ACCOUNT_NOT_FOUND"],
    ["PT222", ForbiddenException, "MANAGER_REQUIRED"],
    ["PT270", ConflictException, "BALANCE_NOT_SETTLED"],
    ["PT271", ConflictException, "ONLINE_REFUND_PENDING"],
    ["PT272", ConflictException, "ACCOUNT_ALREADY_CLOSED"],
    ["PT273", ConflictException, "ACCOUNT_ALREADY_CLOSED"],
    ["PT274", ConflictException, "TABLE_NOT_PENDING_CLEANING"],
    ["PT275", ConflictException, "TABLE_STATE_INVALID"],
    ["PT276", ConflictException, "RECEIPT_NOT_READY"]
  ])(
    "translates %s without echoing database detail",
    async (code, exception, expected) => {
      const service = serviceStub();
      service.closeAccount.mockRejectedValue(databaseError(code));
      const controller = new TableClosingController(service as never);
      const failure = await controller
        .close(request(manager), sessionId, { commandId })
        .catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(exception);
      expect(
        JSON.stringify((failure as ConflictException).getResponse())
      ).toContain(expected);
      expect(
        JSON.stringify((failure as ConflictException).getResponse())
      ).not.toContain("db");
    }
  );

  it("lets unknown failures through", async () => {
    const service = serviceStub();
    service.closeAccount.mockRejectedValue(new Error("boom"));
    await expect(
      new TableClosingController(service as never).close(
        request(waiter),
        sessionId,
        { commandId }
      )
    ).rejects.toThrow("boom");
  });
});
