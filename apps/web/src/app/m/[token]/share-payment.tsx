"use client";

import type {
  OnlinePaymentMethodInput,
  ShareCheckout,
  SharePaymentView
} from "@platform/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import { formatMoney } from "./diner-catalog-format";
import {
  parseShareCheckoutResponse,
  parseSharePaymentResponse
} from "./online-payment";
import { CardBrick, SandboxCheckout, post } from "./online-payment-checkout";

/** Pays a share this phone reserved, with Mercado Pago. */
export function SharePayment({
  position,
  secret,
  token
}: {
  position: number;
  secret: string;
  token: string;
}) {
  const [checkout, setCheckout] = useState<ShareCheckout | null>(null);
  const [view, setView] = useState<SharePaymentView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  const target = { position, secret, token };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void post("/api/online-payments/share/start", target)
      .then((body) => {
        const parsed = parseShareCheckoutResponse(body);
        if (!parsed) throw new Error("invalid checkout");
        setCheckout(parsed);
      })
      .catch(() =>
        setError("No pudimos iniciar el pago de tu parte. Intentá nuevamente.")
      );
    // The target never changes while this panel is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pay = useCallback(
    async (method: OnlinePaymentMethodInput) => {
      setBusy(true);
      setError(null);
      try {
        const parsed = parseSharePaymentResponse(
          await post("/api/online-payments/share/pay", {
            method,
            position,
            secret,
            token
          })
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
    [position, secret, token]
  );

  const check = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const parsed = parseSharePaymentResponse(
        await post("/api/online-payments/share/status", {
          position,
          secret,
          token
        })
      );
      if (!parsed) throw new Error("invalid status");
      setView(parsed);
    } catch {
      setError("No pudimos consultar el estado. Intentá nuevamente.");
    } finally {
      setBusy(false);
    }
  }, [position, secret, token]);

  const payment = view?.payment;
  if (view?.shareStatus === "paid" && payment?.status === "approved") {
    return (
      <section className="diner-payment-status" role="status">
        <h3>Parte pagada</h3>
        <p>Mercado Pago acreditó el cobro de tu parte.</p>
      </section>
    );
  }
  return (
    <section
      aria-label={`Pagar la parte ${position} con Mercado Pago`}
      className="diner-online-payment"
    >
      <p className="diner-help">
        Tu parte:{" "}
        <strong>{formatMoney(checkout?.payment.amountCents ?? 0)}</strong>. Los
        datos de la tarjeta se cargan únicamente en el formulario seguro de
        Mercado Pago.
      </p>
      {payment?.status === "rejected" || payment?.status === "cancelled" ? (
        <p className="diner-warning" role="alert">
          El pago fue rechazado. Tu parte sigue reservada: podés intentar de
          nuevo.
        </p>
      ) : null}
      {payment?.status === "pending" ? (
        <p role="status">
          Todavía no se acreditó. Consultá el estado en un momento.
        </p>
      ) : null}
      {error ? (
        <p className="diner-warning" role="alert">
          {error}
        </p>
      ) : null}
      {!checkout && !error ? <p role="status">Preparando el pago…</p> : null}
      {checkout?.mode === "sandbox" ? (
        <SandboxCheckout busy={busy} onPay={pay} />
      ) : null}
      {checkout?.mode === "live" && payment?.status !== "pending" ? (
        <CardBrick
          checkout={checkout}
          onPay={pay}
          onProblem={() =>
            setError("No pudimos cargar el formulario seguro de Mercado Pago.")
          }
        />
      ) : null}
      {payment?.status === "pending" ? (
        <button
          className="button button-secondary"
          disabled={busy}
          onClick={() => void check()}
          type="button"
        >
          {busy ? "Consultando…" : "Consultar estado"}
        </button>
      ) : null}
    </section>
  );
}
