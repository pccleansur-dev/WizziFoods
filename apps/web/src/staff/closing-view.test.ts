import { describe, expect, it } from "vitest";

import {
  closeBlockedReason,
  closedAccountLabel,
  cashierRequestLabel,
  receiptLines
} from "./closing-view";

const summary = {
  consumedCents: 16_500,
  discountCents: 0,
  paidCents: 16_500,
  pendingCents: 0,
  refundedCents: 0,
  tipCents: 0
};

describe("closing view", () => {
  it("lets a settled account close and explains why any other cannot", () => {
    expect(closeBlockedReason(summary)).toBeNull();
    expect(
      closeBlockedReason({ ...summary, paidCents: 10_000, pendingCents: 6_500 })
    ).toMatch(/saldo/u);
    expect(
      closeBlockedReason({
        ...summary,
        paidCents: 20_000,
        pendingCents: -3_500
      })
    ).toMatch(/a favor/u);
  });

  it("labels a closed account with its table and receipt number", () => {
    expect(
      closedAccountLabel({ receiptNumber: 12, tableLabels: ["2", "3"] })
    ).toBe("Mesas 2 + 3 · Comprobante N° 12");
    expect(closedAccountLabel({ receiptNumber: 3, tableLabels: ["7"] })).toBe(
      "Mesa 7 · Comprobante N° 3"
    );
  });

  it("says what the cashier knows", () => {
    expect(cashierRequestLabel(null)).toBeNull();
    expect(
      cashierRequestLabel({
        requestId: "11111111-1111-4111-8111-111111111111",
        status: "open"
      })
    ).toBe("Caja avisada");
    expect(
      cashierRequestLabel({
        requestId: "11111111-1111-4111-8111-111111111111",
        status: "resolved"
      })
    ).toBe("Caja atendió el aviso");
  });

  it("lists the receipt amounts in the order a diner reads them", () => {
    const lines = receiptLines({
      discounts: [{ amountCents: 500, cause: "Cortesía" }],
      payments: [
        { amountCents: 10_000, method: "cash" },
        { amountCents: 7_000, method: "mercado_pago" }
      ],
      refunds: [{ amountCents: 200, method: "cash" }],
      summary: {
        consumedCents: 16_500,
        discountCents: 500,
        paidCents: 17_000,
        pendingCents: 0,
        refundedCents: 200,
        tipCents: 1_200
      }
    });
    expect(lines.map((line) => line.label)).toEqual([
      "Consumo",
      "Descuento · Cortesía",
      "Propina",
      "Cobrado · Efectivo",
      "Cobrado · Mercado Pago",
      "Devuelto · Efectivo",
      "Saldo"
    ]);
    expect(lines.at(-1)?.value).toMatch(/0/u);
  });
});
