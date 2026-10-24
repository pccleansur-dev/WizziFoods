import { BadRequestException, ConflictException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { OrderIntentController } from "./order-intent.controller.js";

const token = "ab".repeat(32);
const body = {
  attribution: "table",
  commandId: "18000000-0000-4000-8000-000000000003",
  dinerName: "Valentín",
  items: [
    {
      lineId: "18000000-0000-4000-8000-000000000005",
      productId: "18000000-0000-4000-8000-000000000004",
      quantity: 1,
      variantId: null
    }
  ],
  paymentMethod: "cash",
  paymentPath: "in_person",
  seatLabel: null,
  token
};

describe("OrderIntentController", () => {
  it("uses only the context resolved from Host", async () => {
    const context = { location: { id: "location" }, tenant: { id: "tenant" } };
    const service = {
      create: vi.fn().mockResolvedValue({ intentId: "intent" })
    };
    const controller = new OrderIntentController(service as never);
    await expect(
      controller.create({ tenantHostContext: context } as never, body)
    ).resolves.toEqual({
      data: { intentId: "intent" }
    });
    expect(service.create).toHaveBeenCalledWith(context, body);
  });

  it("rejects client-controlled totals and scope", async () => {
    const controller = new OrderIntentController({} as never);
    await expect(
      controller.create({} as never, { ...body, totalCents: 1 })
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.create({} as never, { ...body, tenantId: crypto.randomUUID() })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([
    ["PT100", "ORDER_INTENT_COMMAND_REUSED"],
    ["PT102", "ORDER_INTENT_TABLE_CHANGED"],
    ["PT103", "ORDER_INTENT_PAYMENT_CHANGED"],
    ["PT104", "ORDER_INTENT_ITEMS_CHANGED"],
    ["PT106", "ORDER_INTENT_ITEMS_CHANGED"]
  ])("maps %s without exposing database details", async (code, publicCode) => {
    const service = {
      create: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error("secret detail"), { code }))
    };
    const controller = new OrderIntentController(service as never);
    const error = await controller
      .create({ tenantHostContext: {} } as never, body)
      .catch((caught) => caught);
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toMatchObject({ error: { code: publicCode } });
    expect(JSON.stringify(error.getResponse())).not.toContain("secret detail");
  });

  it("lists the available choices for the host", async () => {
    const listPaymentMethods = vi
      .fn()
      .mockResolvedValue([{ method: "cash", paymentPath: "in_person" }]);
    const context = { location: { id: "location" }, tenant: { id: "tenant" } };
    await expect(
      new OrderIntentController({ listPaymentMethods } as never).options({
        tenantHostContext: context
      } as never)
    ).resolves.toEqual({
      data: { paymentMethods: [{ method: "cash", paymentPath: "in_person" }] }
    });
  });
});
