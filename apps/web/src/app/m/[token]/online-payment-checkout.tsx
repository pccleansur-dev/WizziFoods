"use client";

import type {
  OnlineCheckout,
  OnlinePaymentMethodInput,
  OnlinePaymentView,
  SandboxOutcome
} from "@platform/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import { formatMoney } from "./diner-catalog-format";
import {
  parseOnlineCheckoutResponse,
  parseOnlinePaymentResponse
} from "./online-payment";

type BrickController = { unmount(): Promise<void> | void };
type BrickBuilder = {
  create(
    kind: "cardPayment",
    container: string,
    settings: Record<string, unknown>
  ): Promise<BrickController>;
};
type MercadoPagoClient = { bricks(): BrickBuilder };

declare global {
  interface Window {
    MercadoPago?: new (
      publicKey: string,
      options?: { locale?: string }
    ) => MercadoPagoClient;
  }
}

const sdkUrl = "https://sdk.mercadopago.com/js/v2";

function loadMercadoPago(): Promise<void> {
  if (window.MercadoPago) return Promise.resolve();
  const present = document.querySelector<HTMLScriptElement>(
    `script[src="${sdkUrl}"]`
  );
  return new Promise((resolve, reject) => {
    const script = present ?? document.createElement("script");
    const loaded = () => resolve();
    const failed = () => reject(new Error("Mercado Pago SDK unavailable"));
    script.addEventListener("load", loaded, { once: true });
    script.addEventListener("error", failed, { once: true });
    if (!present) {
      script.async = true;
      script.src = sdkUrl;
      document.head.append(script);
    }
  });
}

export async function post(path: string, body: unknown): Promise<unknown> {
  const response = await fetch(path, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST"
  });
  if (!response.ok) throw new Error("payment request failed");
  return response.json();
}

function cardMethod(formData: unknown): OnlinePaymentMethodInput | null {
  if (typeof formData !== "object" || formData === null) return null;
  const value = formData as Record<string, unknown>;
  const payer =
    typeof value.payer === "object" && value.payer !== null
      ? (value.payer as Record<string, unknown>)
      : null;
  if (
    typeof value.token !== "string" ||
    typeof value.payment_method_id !== "string" ||
    !Number.isInteger(value.installments) ||
    typeof payer?.email !== "string"
  ) {
    return null;
  }
  return {
    card: {
      installments: value.installments as number,
      issuerId:
        typeof value.issuer_id === "string" && value.issuer_id.length > 0
          ? value.issuer_id
          : null,
      payerEmail: payer.email,
      paymentMethodId: value.payment_method_id,
      token: value.token
    },
    kind: "card"
  };
}

export function OnlinePaymentStatus({ view }: { view: OnlinePaymentView }) {
  const payment = view.payment;
  if (view.intentStatus === "confirmed" && payment?.status === "approved") {
    return (
      <section className="diner-payment-status" role="status">
        <p className="eyebrow">Pedido confirmado</p>
        <h2>Pago acreditado</h2>
        <p>Mercado Pago acreditó el cobro. Tu pedido ya fue confirmado.</p>
      </section>
    );
  }
  if (payment?.status === "rejected" || payment?.status === "cancelled") {
    return (
      <section className="diner-payment-status" role="alert">
        <p className="eyebrow">No se realizó el cobro</p>
        <h2>Pago rechazado</h2>
        <p>El pedido sigue sin confirmar. Podés intentar nuevamente.</p>
      </section>
    );
  }
  return (
    <section className="diner-payment-status" role="status">
      <p className="eyebrow">Pago en revisión</p>
      <h2>Todavía no se acreditó</h2>
      <p>
        El pedido no se envía a cocina hasta que Mercado Pago confirme el pago.
      </p>
    </section>
  );
}

export function SandboxCheckout({
  busy,
  onPay
}: {
  busy: boolean;
  onPay(method: OnlinePaymentMethodInput): Promise<void>;
}) {
  const [outcome, setOutcome] = useState<SandboxOutcome>("approved");
  return (
    <div className="diner-payment-sandbox">
      <p className="waiter-chip waiter-chip--claimed">Modo de prueba</p>
      <label className="diner-field">
        Resultado de prueba
        <select
          disabled={busy}
          onChange={(event) => setOutcome(event.target.value as SandboxOutcome)}
          value={outcome}
        >
          <option value="approved">Acreditado</option>
          <option value="pending">Pendiente</option>
          <option value="rejected">Rechazado</option>
        </select>
      </label>
      <button
        className="button diner-primary"
        disabled={busy}
        onClick={() => void onPay({ kind: "sandbox", outcome })}
        type="button"
      >
        {busy ? "Procesando…" : "Simular pago"}
      </button>
    </div>
  );
}

export function CardBrick({
  checkout,
  onPay,
  onProblem
}: {
  checkout: {
    payment: { amountCents: number };
    publicKey: string | null;
  };
  onPay(method: OnlinePaymentMethodInput): Promise<void>;
  onProblem(): void;
}) {
  const controller = useRef<BrickController | null>(null);

  useEffect(() => {
    let active = true;
    if (!checkout.publicKey) {
      onProblem();
      return;
    }
    void loadMercadoPago()
      .then(async () => {
        if (!active || !window.MercadoPago) return;
        const mp = new window.MercadoPago(checkout.publicKey!, {
          locale: "es-AR"
        });
        controller.current = await mp
          .bricks()
          .create("cardPayment", "cardPaymentBrick_container", {
            callbacks: {
              onError: onProblem,
              onReady: () => undefined,
              onSubmit: async (formData: unknown) => {
                const method = cardMethod(formData);
                if (!method) {
                  onProblem();
                  throw new Error("invalid card token");
                }
                await onPay(method);
              }
            },
            initialization: { amount: checkout.payment.amountCents / 100 }
          });
      })
      .catch(onProblem);
    return () => {
      active = false;
      void controller.current?.unmount();
      controller.current = null;
    };
  }, [checkout, onPay, onProblem]);

  return (
    <div aria-label="Pago seguro con tarjeta" id="cardPaymentBrick_container" />
  );
}

export function OnlinePaymentCheckout({
  intentId,
  token
}: {
  intentId: string;
  token: string;
}) {
  const [checkout, setCheckout] = useState<OnlineCheckout | null>(null);
  const [view, setView] = useState<OnlinePaymentView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void post("/api/online-payments", { intentId, token })
      .then((body) => {
        const parsed = parseOnlineCheckoutResponse(body);
        if (!parsed) throw new Error("invalid checkout");
        setCheckout(parsed);
      })
      .catch(() =>
        setError(
          "No pudimos iniciar el pago. Intentá nuevamente en un momento."
        )
      );
  }, [intentId, token]);

  const pay = useCallback(
    async (method: OnlinePaymentMethodInput) => {
      setBusy(true);
      setError(null);
      try {
        const parsed = parseOnlinePaymentResponse(
          await post("/api/online-payments/pay", { intentId, method, token })
        );
        if (!parsed) throw new Error("invalid payment");
        setView(parsed);
      } catch {
        setError(
          "No pudimos procesar el pago. No vuelvas a pagar sin consultar el estado."
        );
      } finally {
        setBusy(false);
      }
    },
    [intentId, token]
  );

  const checkStatus = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const parsed = parseOnlinePaymentResponse(
        await post("/api/online-payments/status", { intentId, token })
      );
      if (!parsed) throw new Error("invalid status");
      setView(parsed);
    } catch {
      setError("No pudimos consultar el estado. Intentá nuevamente.");
    } finally {
      setBusy(false);
    }
  }, [intentId, token]);

  if (view?.intentStatus === "confirmed")
    return <OnlinePaymentStatus view={view} />;

  return (
    <section
      className="diner-checkout diner-online-payment"
      aria-labelledby="online-payment-title"
    >
      <div>
        <p className="eyebrow">Mercado Pago</p>
        <h2 id="online-payment-title">Pagá para confirmar el pedido</h2>
        <p className="diner-help">
          Total:{" "}
          <strong>{formatMoney(checkout?.payment.amountCents ?? 0)}</strong>.
          Los datos de la tarjeta se cargan únicamente en el formulario seguro
          de Mercado Pago.
        </p>
      </div>
      {view ? <OnlinePaymentStatus view={view} /> : null}
      {error ? (
        <p className="diner-warning" role="alert">
          {error}
        </p>
      ) : null}
      {!checkout && !error ? <p role="status">Preparando el pago…</p> : null}
      {checkout?.mode === "sandbox" ? (
        <SandboxCheckout busy={busy} onPay={pay} />
      ) : null}
      {checkout?.mode === "live" && !view ? (
        <CardBrick
          checkout={checkout}
          onPay={pay}
          onProblem={() =>
            setError("No pudimos cargar el formulario seguro de Mercado Pago.")
          }
        />
      ) : null}
      {view?.intentStatus === "payment_pending" ? (
        <button
          className="button button-secondary"
          disabled={busy}
          onClick={() => void checkStatus()}
          type="button"
        >
          {busy ? "Consultando…" : "Consultar estado"}
        </button>
      ) : null}
    </section>
  );
}
