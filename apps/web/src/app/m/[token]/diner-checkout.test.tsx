import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DinerCheckout, DinerIntentAccepted } from "./diner-checkout";

const methods = [
  { method: "cash" as const, paymentPath: "in_person" as const },
  { method: "mercado_pago" as const, paymentPath: "online" as const }
];

describe("DinerCheckout", () => {
  it("renders identified table and individual attribution choices", () => {
    const html = renderToStaticMarkup(
      <DinerCheckout
        error={null}
        methods={methods}
        onBack={() => undefined}
        onSubmit={() => undefined}
        submitting={false}
      />
    );
    expect(html).toContain("Tu nombre");
    expect(html).toContain("Cuenta general");
    expect(html).toContain("Mi consumo");
    expect(html).toContain("Silla");
    expect(html).toContain("Efectivo");
    expect(html).toContain("Mercado Pago");
  });

  it("explains that neither accepted path confirms an order yet", () => {
    expect(
      renderToStaticMarkup(<DinerIntentAccepted status="awaiting_waiter" />)
    ).toContain("validar el pedido");
    expect(
      renderToStaticMarkup(<DinerIntentAccepted status="payment_pending" />)
    ).toContain("no está confirmado");
  });
});
