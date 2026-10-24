"use client";

import {
  paymentMethodLabels,
  PROVIDER_PAYMENT_METHODS,
  type PaymentMethodKey,
  type PaymentMethodStatus
} from "@platform/contracts";
import { useState, useTransition, type FormEvent } from "react";

import type { PaymentsActionState, PaymentsCommand } from "./payments";

export function PaymentMethodsManager({
  initialMethods,
  onCommand
}: {
  initialMethods: PaymentMethodStatus[];
  onCommand: (command: PaymentsCommand) => Promise<PaymentsActionState>;
}) {
  const [methods, setMethods] = useState(initialMethods);
  const [feedback, setFeedback] = useState<PaymentsActionState>({
    message: "",
    methods: null,
    status: "idle"
  });
  const [pending, startTransition] = useTransition();

  function run(command: PaymentsCommand, onDone?: () => void) {
    startTransition(async () => {
      const next = await onCommand(command);
      setFeedback(next);
      if (next.methods) setMethods(next.methods);
      if (next.status === "saved") onDone?.();
    });
  }

  const availableCount = methods.filter((method) => method.available).length;

  return (
    <section
      className="panel-content payments-workspace"
      aria-labelledby="payments-title"
    >
      <p className="eyebrow">Medios de pago</p>
      <h1 id="payments-title">Cómo cobra el negocio</h1>
      <p className="panel-lead">
        Efectivo empieza habilitado y solo se puede deshabilitar si hay otro
        medio disponible. Las credenciales se guardan cifradas y nunca vuelven a
        mostrarse. Medios disponibles: <strong>{availableCount}</strong>.
      </p>
      <p
        aria-live="polite"
        className={
          feedback.status === "saved"
            ? "form-message form-message--success"
            : feedback.status === "idle"
              ? "form-message"
              : "form-message form-message--error"
        }
        role={feedback.status === "idle" ? undefined : "status"}
      >
        {feedback.message}
      </p>
      <ul className="payment-list" aria-label="Medios de pago">
        {methods.map((method) => (
          <MethodCard
            key={method.method}
            method={method}
            pending={pending}
            run={run}
          />
        ))}
      </ul>
    </section>
  );
}

function MethodCard({
  method,
  pending,
  run
}: {
  method: PaymentMethodStatus;
  pending: boolean;
  run: (command: PaymentsCommand, onDone?: () => void) => void;
}) {
  const isProvider = PROVIDER_PAYMENT_METHODS.includes(method.method);
  const label = paymentMethodLabels[method.method];

  function toggle(key: PaymentMethodKey, enabled: boolean) {
    run({ enabled, method: key, publicKey: null, type: "update" });
  }

  function saveConfig(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    run({
      enabled: method.enabled,
      method: method.method,
      publicKey: String(data.get("publicKey") ?? "").trim(),
      type: "update"
    });
  }

  function saveSecret(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    run(
      {
        method: method.method,
        secret: String(data.get("secret") ?? ""),
        type: "credential"
      },
      () => form.reset()
    );
  }

  return (
    <li className="payment-card">
      <div className="payment-card__summary">
        <div>
          <strong>{label}</strong>{" "}
          <span
            className={
              method.available
                ? "status-pill"
                : "status-pill status-pill--draft"
            }
          >
            {method.available
              ? "Disponible"
              : method.enabled
                ? "Habilitado, incompleto"
                : "Deshabilitado"}
          </span>
        </div>
        <button
          aria-pressed={method.enabled}
          className={
            method.enabled
              ? "button button--secondary"
              : "button button--primary"
          }
          disabled={pending}
          onClick={() => toggle(method.method, !method.enabled)}
          type="button"
        >
          {method.enabled ? "Deshabilitar" : "Habilitar"}
        </button>
      </div>

      {isProvider ? (
        <div className="payment-card__provider">
          <form className="profile-form" onSubmit={saveConfig}>
            <label className="field-group">
              <span>Clave pública</span>
              <input
                autoComplete="off"
                defaultValue={method.publicConfig.publicKey ?? ""}
                maxLength={200}
                name="publicKey"
                pattern="[A-Za-z0-9_\-]{8,200}"
                spellCheck={false}
              />
            </label>
            <button
              className="button button--secondary"
              disabled={pending}
              type="submit"
            >
              Guardar clave pública
            </button>
          </form>
          <form className="profile-form" onSubmit={saveSecret}>
            <label className="field-group">
              <span>
                Credencial privada{" "}
                {method.configured
                  ? "(guardada, no se puede ver)"
                  : "(sin cargar)"}
              </span>
              <input
                autoComplete="new-password"
                maxLength={512}
                minLength={8}
                name="secret"
                placeholder={method.configured ? "••••••••••••" : ""}
                required
                spellCheck={false}
                type="password"
              />
            </label>
            <button
              className="button button--primary"
              disabled={pending}
              type="submit"
            >
              {method.configured
                ? "Reemplazar credencial"
                : "Guardar credencial"}
            </button>
            {method.configured ? (
              <button
                className="button button--danger"
                disabled={pending}
                onClick={() =>
                  run({ method: method.method, type: "clear-credential" })
                }
                type="button"
              >
                Eliminar credencial
              </button>
            ) : null}
          </form>
        </div>
      ) : null}
    </li>
  );
}
