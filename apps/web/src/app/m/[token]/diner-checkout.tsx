"use client";

import {
  paymentMethodLabels,
  type OrderAttribution
} from "@platform/contracts";
import { useState, type FormEvent } from "react";

import type { OrderIntentPaymentMethod } from "./order-intent";

export type DinerCheckoutValue = {
  attribution: OrderAttribution;
  dinerName: string;
  paymentMethod: OrderIntentPaymentMethod;
  seatLabel: string | null;
};

export function DinerCheckout({
  error,
  methods,
  onBack,
  onSubmit,
  submitting
}: {
  error: string | null;
  methods: OrderIntentPaymentMethod[];
  onBack(): void;
  onSubmit(value: DinerCheckoutValue): void;
  submitting: boolean;
}) {
  const [attribution, setAttribution] = useState<OrderAttribution>("table");
  const [dinerName, setDinerName] = useState("");
  const [paymentMethod, setPaymentMethod] = useState(methods[0]?.method ?? "");
  const [seatLabel, setSeatLabel] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const selected = methods.find(({ method }) => method === paymentMethod);
    if (!selected) return;
    onSubmit({
      attribution,
      dinerName: dinerName.trim(),
      paymentMethod: selected,
      seatLabel: seatLabel.trim() || null
    });
  }

  return (
    <form className="diner-checkout" onSubmit={submit}>
      <div>
        <p className="eyebrow">Confirmación</p>
        <h2>¿Cómo querés pedir?</h2>
        <p className="diner-help">
          El nombre identifica quién hace el pedido. Todavía no se envía a
          cocina.
        </p>
      </div>
      <label className="diner-field">
        Tu nombre
        <input
          autoComplete="name"
          maxLength={80}
          onChange={(event) => setDinerName(event.target.value)}
          required
          value={dinerName}
        />
      </label>
      <fieldset className="diner-choice-group">
        <legend>¿A qué cuenta va?</legend>
        <label>
          <input
            checked={attribution === "table"}
            name="attribution"
            onChange={() => setAttribution("table")}
            type="radio"
          />
          <span>
            <strong>Cuenta general</strong>
            <small>Para compartir con toda la mesa.</small>
          </span>
        </label>
        <label>
          <input
            checked={attribution === "individual"}
            name="attribution"
            onChange={() => setAttribution("individual")}
            type="radio"
          />
          <span>
            <strong>Mi consumo</strong>
            <small>Queda identificado con nombre y silla.</small>
          </span>
        </label>
      </fieldset>
      <label className="diner-field">
        Silla {attribution === "table" ? "(opcional)" : ""}
        <input
          maxLength={40}
          onChange={(event) => setSeatLabel(event.target.value)}
          placeholder="Ej.: Silla 2"
          required={attribution === "individual"}
          value={seatLabel}
        />
      </label>
      <fieldset className="diner-choice-group">
        <legend>Medio de pago</legend>
        {methods.map((choice) => (
          <label key={choice.method}>
            <input
              checked={paymentMethod === choice.method}
              name="paymentMethod"
              onChange={() => setPaymentMethod(choice.method)}
              type="radio"
            />
            <span>
              <strong>{paymentMethodLabels[choice.method]}</strong>
              <small>
                {choice.paymentPath === "online"
                  ? "Quedará pendiente hasta que Mercado Pago acredite el pago."
                  : "El mozo se acerca para validar productos y cobro."}
              </small>
            </span>
          </label>
        ))}
      </fieldset>
      {methods.length === 0 ? (
        <p className="diner-warning" role="alert">
          No hay medios de pago disponibles.
        </p>
      ) : null}
      {error ? (
        <p className="diner-warning" role="alert">
          {error}
        </p>
      ) : null}
      <div className="diner-checkout-actions">
        <button
          className="button button-secondary"
          disabled={submitting}
          onClick={onBack}
          type="button"
        >
          Volver
        </button>
        <button
          className="button diner-primary"
          disabled={submitting || methods.length === 0}
          type="submit"
        >
          {submitting ? "Enviando…" : "Enviar pedido"}
        </button>
      </div>
    </form>
  );
}

export function DinerIntentAccepted({
  status
}: {
  status: "awaiting_waiter" | "payment_pending";
}) {
  return (
    <section className="diner-accepted" role="status">
      <p className="eyebrow">Solicitud recibida</p>
      <h2>
        {status === "awaiting_waiter"
          ? "Ya avisamos al mozo"
          : "Pago pendiente"}
      </h2>
      <p>
        {status === "awaiting_waiter"
          ? "Se va a acercar para revisar los productos, validar el pedido y acordar el cobro."
          : "Tu pedido no está confirmado ni fue enviado a cocina. Se confirmará sólo cuando Mercado Pago acredite el pago."}
      </p>
    </section>
  );
}
