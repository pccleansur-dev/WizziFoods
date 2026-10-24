import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException
} from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { ProductionController } from "./production.controller.js";

const commandId = "11111111-1111-4111-8111-111111111111";
const orderId = "22222222-2222-4222-8222-222222222222";
const lineId = "33333333-3333-4333-8333-333333333333";

function request(capabilities: string[]) {
  return {
    staffContext: {
      capabilities,
      role: "kitchen",
      scope: { locationId: "location", tenantId: "tenant" },
      staffId: "staff"
    }
  } as never;
}

function serviceStub() {
  return {
    advanceItem: vi.fn().mockResolvedValue({ changed: true }),
    getBoard: vi.fn().mockResolvedValue({ tickets: [] })
  };
}

function databaseError(code: string) {
  return Object.assign(new Error("db"), { code });
}

describe("ProductionController", () => {
  it.each([["production.kitchen.manage"], ["production.bar.manage"]])(
    "serves the board to staff with %s",
    async (capability) => {
      const service = serviceStub();
      const context = request([capability]);
      await expect(
        new ProductionController(service as never).board(context)
      ).resolves.toEqual({ data: { tickets: [] } });
      expect(service.getBoard).toHaveBeenCalledWith(
        (context as never as { staffContext: unknown }).staffContext
      );
    }
  );

  it("forbids roles without a production capability", async () => {
    const controller = new ProductionController(serviceStub() as never);
    for (const capabilities of [
      [],
      ["tables.serve", "orders.manage", "orders.validate", "calls.manage"]
    ]) {
      await expect(
        controller.board(request(capabilities))
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        controller.advance(request(capabilities), orderId, lineId, {
          commandId,
          status: "ready"
        })
      ).rejects.toBeInstanceOf(ForbiddenException);
    }
  });

  it.each([
    ["a client tenant", { commandId, status: "ready", tenantId: "t" }],
    ["a client sector", { commandId, sector: "bar", status: "ready" }],
    ["a queue target", { commandId, status: "queued" }],
    ["no command id", { status: "ready" }]
  ])("rejects %s before reaching the service", async (_name, body) => {
    const service = serviceStub();
    await expect(
      new ProductionController(service as never).advance(
        request(["production.kitchen.manage"]),
        orderId,
        lineId,
        body
      )
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.advanceItem).not.toHaveBeenCalled();
  });

  it("rejects malformed route identifiers", async () => {
    const service = serviceStub();
    const controller = new ProductionController(service as never);
    await expect(
      controller.advance(
        request(["production.kitchen.manage"]),
        "not-a-uuid",
        lineId,
        { commandId, status: "ready" }
      )
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.advanceItem).not.toHaveBeenCalled();
  });

  it("advances an item from the session context and the route", async () => {
    const service = serviceStub();
    const context = request(["production.kitchen.manage"]);
    await expect(
      new ProductionController(service as never).advance(
        context,
        orderId,
        lineId,
        { commandId, status: "preparing" }
      )
    ).resolves.toEqual({ data: { changed: true } });
    expect(service.advanceItem).toHaveBeenCalledWith(
      (context as never as { staffContext: unknown }).staffContext,
      orderId,
      lineId,
      { commandId, status: "preparing" }
    );
  });

  it.each([
    ["PT100", ConflictException],
    ["PT200", ForbiddenException],
    ["PT201", NotFoundException],
    ["PT212", BadRequestException],
    ["PT220", ConflictException]
  ])("maps %s without echoing database detail", async (code, expected) => {
    const service = serviceStub();
    service.advanceItem.mockRejectedValue(databaseError(code));
    const failure = await new ProductionController(service as never)
      .advance(request(["production.bar.manage"]), orderId, lineId, {
        commandId,
        status: "ready"
      })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(expected);
    expect(
      JSON.stringify((failure as Error & { response: unknown }).response)
    ).not.toContain("db");
  });

  it("rethrows unknown failures", async () => {
    const service = serviceStub();
    service.getBoard.mockRejectedValue(new Error("boom"));
    await expect(
      new ProductionController(service as never).board(
        request(["production.kitchen.manage"])
      )
    ).rejects.toThrow("boom");
  });
});
