import {
  BadRequestException,
  ConflictException,
  HttpException
} from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { WaiterCallController } from "./waiter-call.controller.js";

const token = "ab".repeat(32);
const body = { reason: "call_waiter", token };
const context = { location: { id: "location" }, tenant: { id: "tenant" } };

function failing(code: string) {
  return {
    create: vi
      .fn()
      .mockRejectedValue(Object.assign(new Error("secret detail"), { code }))
  };
}

describe("WaiterCallController", () => {
  it("uses only the context resolved from Host", async () => {
    const result = { callId: "call", created: true };
    const service = { create: vi.fn().mockResolvedValue(result) };
    const controller = new WaiterCallController(service as never);
    await expect(
      controller.create({ tenantHostContext: context } as never, body)
    ).resolves.toEqual({ data: result });
    expect(service.create).toHaveBeenCalledWith(context, body);
  });

  it.each([
    ["scope", { ...body, tenantId: crypto.randomUUID() }],
    ["table", { ...body, tableId: crypto.randomUUID() }],
    ["reason", { ...body, reason: "order_validation" }],
    ["token", { ...body, token: "short" }],
    ["body", null]
  ])("rejects a client-controlled or invalid %s", async (_name, payload) => {
    const service = { create: vi.fn() };
    const controller = new WaiterCallController(service as never);
    await expect(
      controller.create({ tenantHostContext: context } as never, payload)
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.create).not.toHaveBeenCalled();
  });

  it.each([
    ["PT101", ConflictException, "WAITER_CALL_TABLE_CHANGED"],
    ["PT102", ConflictException, "WAITER_CALL_TABLE_CHANGED"],
    ["PT120", BadRequestException, "INVALID_WAITER_CALL"],
    ["PT121", ConflictException, "WAITER_CALL_NO_OPEN_TABLE"],
    ["PT122", HttpException, "WAITER_CALL_RATE_LIMITED"]
  ])(
    "maps %s without exposing database details",
    async (code, errorType, publicCode) => {
      const controller = new WaiterCallController(failing(code) as never);
      const error = await controller
        .create({ tenantHostContext: context } as never, body)
        .catch((caught) => caught);
      expect(error).toBeInstanceOf(errorType);
      expect(error.getResponse()).toMatchObject({
        error: { code: publicCode }
      });
      expect(JSON.stringify(error.getResponse())).not.toContain(
        "secret detail"
      );
    }
  );

  it("answers 429 when a table floods the waiters", async () => {
    const error = await new WaiterCallController(failing("PT122") as never)
      .create({ tenantHostContext: context } as never, body)
      .catch((caught) => caught);
    expect(error.getStatus()).toBe(429);
  });

  it("does not hide unexpected failures", async () => {
    const service = { create: vi.fn().mockRejectedValue(new Error("boom")) };
    await expect(
      new WaiterCallController(service as never).create(
        { tenantHostContext: context } as never,
        body
      )
    ).rejects.toThrow("boom");
  });
});
