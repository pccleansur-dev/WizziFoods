"use client";

import {
  sandboxStepLabels,
  type ReadinessItem,
  type ReadinessReport
} from "@platform/contracts";
import Link from "next/link";
import { useState, useTransition } from "react";

import type { ReadinessActionState, ReadinessCommand } from "./readiness";

function RequirementList({
  emptyText,
  items,
  title
}: {
  emptyText: string;
  items: ReadinessItem[];
  title: string;
}) {
  return (
    <div aria-label={title} role="group">
      <h2>{title}</h2>
      {items.length === 0 ? (
        <p className="panel-lead">{emptyText}</p>
      ) : (
        <ul className="payment-list">
          {items.map((item) => (
            <li className="payment-card" key={item.code}>
              <p>{item.message}</p>
              <Link className="button button--secondary" href={item.href}>
                Ir al paso
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ReadinessManager({
  initialReadiness,
  onCommand
}: {
  initialReadiness: ReadinessReport;
  onCommand: (command: ReadinessCommand) => Promise<ReadinessActionState>;
}) {
  const [readiness, setReadiness] = useState(initialReadiness);
  const [feedback, setFeedback] = useState<ReadinessActionState>({
    message: "",
    readiness: null,
    run: null,
    status: "idle"
  });
  const [pending, startTransition] = useTransition();

  function run(command: ReadinessCommand) {
    startTransition(async () => {
      const next = await onCommand(command);
      setFeedback(next);
      if (next.readiness) setReadiness(next.readiness);
    });
  }

  const blockers = readiness.items.filter(
    (item) => item.severity === "blocker"
  );
  const warnings = readiness.items.filter(
    (item) => item.severity === "warning"
  );

  return (
    <section
      className="panel-content payments-workspace"
      aria-labelledby="readiness-title"
    >
      <p className="eyebrow">Publicación</p>
      <h1 id="readiness-title">Publicar el negocio</h1>
      <p className="panel-lead">
        {readiness.published
          ? "El negocio está publicado. Los cambios siguientes se guardan como avances y la carta se publica por separado."
          : "Guardar avances nunca está bloqueado. Solo publicar exige que se cumplan los mínimos."}
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

      <RequirementList
        emptyText="Se cumplen todos los mínimos para publicar."
        items={blockers}
        title="Falta para publicar"
      />
      <RequirementList
        emptyText="No hay recomendaciones pendientes."
        items={warnings}
        title="Recomendado"
      />

      <div className="payment-card__summary">
        <button
          className="button"
          disabled={pending || !readiness.ready || readiness.published !== null}
          onClick={() => run("publish")}
          type="button"
        >
          Publicar el negocio
        </button>
      </div>

      <div aria-label="Modo prueba" role="group">
        <h2>Modo prueba</h2>
        <p className="panel-lead">
          Recorre QR, pedido, producción, pago, cierre y limpieza con datos de
          prueba. Los datos simulados no se mezclan con la operación real, no
          usan tus medios de pago y se eliminan al terminar.
        </p>
        <div className="payment-card__summary">
          <button
            className="button button--secondary"
            disabled={pending}
            onClick={() => run("simulate")}
            type="button"
          >
            Simular un pedido de prueba
          </button>
          <button
            className="button button--secondary"
            disabled={pending}
            onClick={() => run("cleanup")}
            type="button"
          >
            Limpiar datos de prueba
          </button>
        </div>
        {feedback.run ? (
          <ol aria-label="Resultado de la simulación">
            <li>Referencia de prueba {feedback.run.reference}</li>
            {feedback.run.steps.map((step) => (
              <li key={step.step}>
                {sandboxStepLabels[step.step]}: {step.ok ? "correcto" : "falló"}
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </section>
  );
}
