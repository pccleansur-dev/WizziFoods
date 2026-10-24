import { describe, expect, it, vi } from "vitest";

import { createOrderIntentRepository } from "./order-intent-repository.js";

const scope = {
  locationId: "18000000-0000-4000-8000-000000000001",
  tenantId: "18000000-0000-4000-8000-000000000002"
};
const token = "ab".repeat(32);
const commandId = "18000000-0000-4000-8000-000000000003";
const productId = "18000000-0000-4000-8000-000000000004";
const lineId = "18000000-0000-4000-8000-000000000005";
const intentId = "18000000-0000-4000-8000-000000000006";
const callId = "18000000-0000-4000-8000-000000000007";

const request = {
  attribution: "table" as const,
  commandId,
  dinerName: "Valentín",
  items: [{ lineId, productId, quantity: 2, variantId: null }],
  paymentMethod: "cash" as const,
  paymentPath: "in_person" as const,
  seatLabel: null,
  token
};

const result = {
  callId,
  intentId,
  items: [
    {
      ...request.items[0],
      status: "available" as const,
      title: "Milanesa",
      totalCents: 25_000,
      unitPriceCents: 12_500,
      variantTitle: null
    }
  ],
  status: "awaiting_waiter" as const,
  totalCents: 25_000
};

function clientReturning(rows: unknown[]) {
  return vi.fn(() => Promise.resolve(rows)) as never;
}

describe("order intent repository", () => {
  it("creates an intent only inside the host-derived scope", async () => {
    const client = clientReturning([{ result }]);
    await expect(
      createOrderIntentRepository(client).create({ request, scope })
    ).resolves.toEqual(result);
    expect(client).toHaveBeenCalledOnce();
  });

  it("rejects a non-canonical request before querying", async () => {
    const client = vi.fn(() => {
      throw new Error("database must not be queried");
    }) as never;
    await expect(
      createOrderIntentRepository(client).create({
        request: { ...request, totalCents: 1 } as never,
        scope
      })
    ).rejects.toThrow("order intent request must be canonical");
    expect(client).not.toHaveBeenCalled();
  });

  it("maps only available public payment methods", async () => {
    const repository = createOrderIntentRepository(
      clientReturning([
        { method: "cash", payment_path: "in_person" },
        { method: "mercado_pago", payment_path: "online" }
      ])
    );
    await expect(repository.listPaymentMethods(scope)).resolves.toEqual([
      { method: "cash", paymentPath: "in_person" },
      { method: "mercado_pago", paymentPath: "online" }
    ]);
  });

  it("fails closed on an unexpected database result", async () => {
    await expect(
      createOrderIntentRepository(
        clientReturning([{ result: { ...result, totalCents: -1 } }])
      ).create({
        request,
        scope
      })
    ).rejects.toThrow("order intent result must be canonical");
  });
});
