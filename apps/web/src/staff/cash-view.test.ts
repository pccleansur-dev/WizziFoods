import type { WaiterAccount } from "@platform/contracts";
import { describe, expect, it } from "vitest";

import {
  breakdownLines,
  cashDifferenceLabel,
  cashMovementLabel,
  closureSummary,
  onlineRefundablePayments,
  refundablePayments
} from "./cash-view";

const money = (cents: number) =>
  new Intl.NumberFormat("es-AR", {
    currency: "ARS",
    style: "currency"
  }).format(cents / 100);

describe("cash view helpers", () => {
  it("names the movement kinds", () => {
    expect(cashMovementLabel("cash_in")).toBe("Ingreso de efectivo");
    expect(cashMovementLabel("cash_out")).toBe("Retiro de efectivo");
  });

  it("words the difference of a count", () => {
    expect(cashDifferenceLabel(0)).toBe("Sin diferencia");
    expect(cashDifferenceLabel(-700)).toContain("Faltan");
    expect(cashDifferenceLabel(-700)).toContain(money(700).trim());
    expect(cashDifferenceLabel(300)).toContain("Sobran");
  });

  it("lists methods in a fixed order with what was given back", () => {
    const lines = breakdownLines({
      manualInCents: 0,
      manualOutCents: 0,
      methods: {
        debit_card: { receivedCents: 4_000, refundedCents: 1_000 },
        cash: { receivedCents: 8_000, refundedCents: 0 }
      },
      tipCents: 0
    });
    expect(lines.map((line) => line.label)).toEqual([
      "Efectivo",
      "Tarjeta de débito"
    ]);
    expect(lines[1]!.net).toContain("devuelto");
    expect(lines[0]!.net).not.toContain("devuelto");
  });

  it("summarizes a closure with its pending accounts", () => {
    const base = {
      breakdown: {
        manualInCents: 0,
        manualOutCents: 0,
        methods: {},
        tipCents: 0
      },
      closedAt: "2026-10-24T12:00:00.000Z",
      closedByName: "marta",
      countedCashCents: 100,
      differenceCents: 0,
      expectedCashCents: 100,
      openedAt: "2026-10-24T10:00:00.000Z",
      openedByName: "marta",
      openingCashCents: 0,
      pendingAccounts: 0,
      pendingCents: 0,
      reason: null,
      shiftId: "s"
    };
    expect(closureSummary(base)).toBe("Sin diferencia");
    expect(
      closureSummary({ ...base, pendingAccounts: 2, pendingCents: 5_000 })
    ).toContain("2 cuentas con");
    expect(
      closureSummary({ ...base, pendingAccounts: 1, pendingCents: 5_000 })
    ).toContain("1 cuenta con");
  });

  it("offers only payments of the account as refund targets", () => {
    const entry = (
      id: number,
      kind: "payment" | "charge" | "refund",
      amountCents: number,
      sourceId: string,
      paymentMethod: "cash" | "debit_card" | "mercado_pago" | null
    ) => ({
      amountCents,
      cause: "x",
      createdAt: "2026-10-24T12:00:00.000Z",
      id,
      kind,
      origin: "staff",
      paymentMethod,
      sourceId
    });
    const account = {
      entries: [
        entry(1, "charge", 12_500, "c1", null),
        entry(2, "payment", -10_000, "p1", "cash"),
        entry(3, "payment", -4_000, "p2", "debit_card"),
        entry(4, "refund", 4_000, "r1", "debit_card"),
        entry(5, "payment", -12_500, "p3", "mercado_pago")
      ]
    } as unknown as WaiterAccount;
    expect(refundablePayments(account)).toEqual([
      {
        amountCents: 10_000,
        label: expect.stringContaining("Efectivo"),
        paymentId: "p1"
      },
      {
        amountCents: 4_000,
        label: expect.stringContaining("débito"),
        paymentId: "p2"
      }
    ]);
    expect(onlineRefundablePayments(account)).toEqual([
      {
        amountCents: 12_500,
        label: expect.stringContaining("Mercado Pago"),
        paymentId: "p3"
      }
    ]);
  });
});
