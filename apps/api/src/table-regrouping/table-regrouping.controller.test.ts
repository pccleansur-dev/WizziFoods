import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException
} from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { TableRegroupingController } from "./table-regrouping.controller.js";

const commandId = "11111111-1111-4111-8111-111111111111";
const tableA = "22222222-2222-4222-8222-222222222222";
const tableB = "33333333-3333-4333-8333-333333333333";
const groupId = "44444444-4444-4444-8444-444444444444";

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
const kitchen = ["production.kitchen.manage"];
const joinBody = { commandId, tableIds: [tableA, tableB] };

function serviceStub() {
  return {
    joinTables: vi.fn().mockResolvedValue({ groupId }),
    separateTables: vi.fn().mockResolvedValue({ groupId })
  };
}

function databaseError(code: string) {
  return Object.assign(new Error("db"), { code });
}

describe("TableRegroupingController", () => {
  it("joins with the tables and name from the body and the scope from the session only", async () => {
    const service = serviceStub();
    const context = request(waiter);
    await expect(
      new TableRegroupingController(service as never).join(context, {
        ...joinBody,
        name: "Cumpleaños"
      })
    ).resolves.toEqual({ data: { groupId } });
    expect(service.joinTables).toHaveBeenCalledWith(
      (context as never as { staffContext: unknown }).staffContext,
      { commandId, name: "Cumpleaños", tableIds: [tableA, tableB] }
    );
  });

  it("separates with the group from the path and the anchor from the body", async () => {
    const service = serviceStub();
    const context = request(waiter);
    await new TableRegroupingController(service as never).separate(
      context,
      groupId,
      { anchorTableId: tableA, commandId }
    );
    expect(service.separateTables).toHaveBeenCalledWith(
      (context as never as { staffContext: unknown }).staffContext,
      groupId,
      { anchorTableId: tableA, commandId }
    );
  });

  it("only the floor staff may join or separate", async () => {
    const controller = new TableRegroupingController(serviceStub() as never);
    for (const denied of [kitchen, []]) {
      await expect(
        controller.join(request(denied), joinBody)
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        controller.separate(request(denied), groupId, { commandId })
      ).rejects.toBeInstanceOf(ForbiddenException);
    }
  });

  it.each([
    ["one table", { commandId, tableIds: [tableA] }],
    ["the same table twice", { commandId, tableIds: [tableA, tableA] }],
    ["a tenant", { ...joinBody, tenantId: tableA }],
    ["a ledger amount", { ...joinBody, amountCents: 0 }],
    ["no command", { tableIds: [tableA, tableB] }]
  ])("rejects %s before reaching the service", async (_name, body) => {
    const service = serviceStub();
    await expect(
      new TableRegroupingController(service as never).join(
        request(waiter),
        body
      )
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.joinTables).not.toHaveBeenCalled();
  });

  it("rejects a separation with a bad group, a bad anchor or an extra field", async () => {
    const service = serviceStub();
    const controller = new TableRegroupingController(service as never);
    await expect(
      controller.separate(request(waiter), "nope", { commandId })
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.separate(request(waiter), groupId, {
        anchorTableId: "x",
        commandId
      })
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.separate(request(waiter), groupId, {
        commandId,
        sessionId: tableA
      })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.separateTables).not.toHaveBeenCalled();
  });

  it.each([
    ["PT100", ConflictException, "WAITER_COMMAND_REUSED"],
    ["PT200", ForbiddenException, "STAFF_FORBIDDEN"],
    ["PT201", NotFoundException, "TABLE_GROUP_NOT_FOUND"],
    ["PT277", ConflictException, "TABLES_CANNOT_BE_JOINED"],
    ["PT278", ConflictException, "DIFFERENT_OPEN_ACCOUNTS"],
    ["PT279", ConflictException, "ANCHOR_TABLE_REQUIRED"]
  ])(
    "translates %s without echoing database detail",
    async (code, exception, expected) => {
      const service = serviceStub();
      service.joinTables.mockRejectedValue(databaseError(code));
      service.separateTables.mockRejectedValue(databaseError(code));
      const controller = new TableRegroupingController(service as never);
      for (const call of [
        controller.join(request(waiter), joinBody),
        controller.separate(request(waiter), groupId, { commandId })
      ]) {
        const failure = await call.catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(exception);
        const body = JSON.stringify(
          (failure as ConflictException).getResponse()
        );
        expect(body).toContain(expected);
        expect(body).not.toContain('"db"');
      }
    }
  );

  it("lets unknown failures through", async () => {
    const service = serviceStub();
    service.joinTables.mockRejectedValue(new Error("boom"));
    await expect(
      new TableRegroupingController(service as never).join(
        request(waiter),
        joinBody
      )
    ).rejects.toThrow("boom");
  });
});
