import type { AccountSummary, WaiterAccount } from "@platform/contracts";
import { describe, expect, it } from "vitest";

import {
  accountBalanceLabel,
  accountForTable,
  movementLabel,
  paymentMethodChoices,
  parseMoneyInput,
  percentLabel
} from "./account-view";

const plain = (text: string) => text.replaceAll(String.fromCharCode(160), " ");

function summary(pendingCents: number): AccountSummary {
  return {
    consumedCents: pendingCents,
    discountCents: 0,
    paidCents: 0,
    pendingCents,
    refundedCents: 0,
    tipCents: 0
  };
}

function account(labels: string[], pendingCents = 100): WaiterAccount {
  return {
    currency: "ARS",
    entries: [],
    keptOpen: false,
    openedAt: "2026-10-24T11:00:00.000Z",
    sessionId: "22222222-2222-4222-8222-222222222222",
    summary: summary(pendingCents),
    tableId: "33333333-3333-4333-8333-333333333333",
    tableLabels: labels
  };
}

describe("account view helpers", () => {
  it("says what is owed, settled or in favor of the diner", () => {
    expect(plain(accountBalanceLabel(summary(15_000)))).toBe(
      "Pendiente $ 150,00"
    );
    expect(accountBalanceLabel(summary(0))).toBe("Cuenta saldada");
    expect(plain(accountBalanceLabel(summary(-2_000)))).toBe(
      "A favor del comensal $ 20,00"
    );
  });

  it("names every movement kind in the operators' words", () => {
    expect(movementLabel("charge")).toBe("Consumo");
    expect(movementLabel("adjustment")).toBe("Ajuste");
    expect(movementLabel("discount")).toBe("Descuento");
    expect(movementLabel("payment")).toBe("Cobro");
    expect(movementLabel("tip")).toBe("Propina");
    expect(movementLabel("refund")).toBe("Devolución");
  });

  it("offers only in-person payment methods", () => {
    expect(paymentMethodChoices.map((choice) => choice.value)).toEqual([
      "cash",
      "credit_card",
      "debit_card",
      "other_in_person"
    ]);
  });

  it("parses typed money into cents without floating point drift", () => {
    expect(parseMoneyInput("150")).toBe(15_000);
    expect(parseMoneyInput("150,50")).toBe(15_050);
    expect(parseMoneyInput("150.5")).toBe(15_050);
    expect(parseMoneyInput("0,07")).toBe(7);
    expect(parseMoneyInput("1.234,56")).toBe(123_456);
    expect(parseMoneyInput("")).toBeNull();
    expect(parseMoneyInput("abc")).toBeNull();
    expect(parseMoneyInput("-5")).toBeNull();
    expect(parseMoneyInput("1,234")).toBeNull();
  });

  it("shows a percentage in basis points", () => {
    expect(percentLabel(1_000)).toBe("10 %");
    expect(percentLabel(1_250)).toBe("12,5 %");
    expect(percentLabel(10_000)).toBe("100 %");
  });

  it("finds the account of a table, grouped tables included", () => {
    const accounts = [account(["2", "3"]), account(["5"])];
    expect(accountForTable(accounts, "3")).toBe(accounts[0]);
    expect(accountForTable(accounts, "5")).toBe(accounts[1]);
    expect(accountForTable(accounts, "9")).toBeUndefined();
  });
});
