import type { OnlinePaymentView } from "@platform/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OnlinePaymentStatus } from "./online-payment-checkout";

const view = (status: "approved" | "pending" | "rejected") =>
  ({
    intentId: "22222222-2222-4222-8222-222222222222",
    intentStatus: status === "approved" ? "confirmed" : "payment_pending",
    payment: {
      amountCents: 12_500,
      fulfillment: status === "approved" ? "confirmed" : "waiting",
      paymentId: "33333333-3333-4333-8333-333333333333",
      refundedCents: 0,
      status,
      statusDetail: null
    },
    totalCents: 12_500
  }) satisfies OnlinePaymentView;

describe("online payment status", () => {
  it("says that only an accredited payment confirms the order", () => {
    expect(
      renderToStaticMarkup(<OnlinePaymentStatus view={view("approved")} />)
    ).toContain("Pago acreditado");
    expect(
      renderToStaticMarkup(<OnlinePaymentStatus view={view("pending")} />)
    ).toContain("Todavía no se acreditó");
    expect(
      renderToStaticMarkup(<OnlinePaymentStatus view={view("rejected")} />)
    ).toContain("Pago rechazado");
  });
});
