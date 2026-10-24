import Link from "next/link";

import type { OnboardingProgress, OnboardingStepStatus } from "./steps";

const statusLabel: Record<OnboardingStepStatus, string> = {
  blocked: "Se habilita al completar los pasos anteriores",
  done: "Completo",
  optional: "Opcional",
  pending: "Pendiente"
};

/** Inicio del panel: dónde quedó la puesta en marcha y a qué paso seguir. */
export function OnboardingOverview({
  progress
}: {
  progress: OnboardingProgress;
}) {
  const next = progress.steps.find(({ key }) => key === progress.next);
  const finished = progress.percent === 100;
  return (
    <section aria-labelledby="onboarding-title" className="onboarding-overview">
      <p className="eyebrow">Puesta en marcha</p>
      <h2 id="onboarding-title">
        {finished
          ? "Tu negocio está publicado"
          : `Tu negocio está al ${progress.percent}%`}
      </h2>
      <p className="panel-lead">
        {finished
          ? "Podés volver a cualquier paso para cambiar lo que necesites."
          : "Completá los pasos para poder publicar. Podés dejar uno a medias y volver cuando quieras."}
      </p>
      <div
        aria-label={`Avance ${progress.percent}%`}
        className="onboarding-bar"
        role="img"
      >
        <span style={{ width: `${progress.percent}%` }} />
      </div>
      <ol className="onboarding-list">
        {progress.steps.map((step, index) => (
          <li
            className={`onboarding-list__item onboarding-list__item--${step.status}`}
            key={step.key}
          >
            <span aria-hidden="true" className="onboarding-step__mark">
              {step.status === "done" ? "✓" : index + 1}
            </span>
            <div>
              <Link href={step.href}>
                <strong>{step.title}</strong>
              </Link>
              <span className="onboarding-list__status">
                {statusLabel[step.status]}
              </span>
              <p>{step.missing[0] ?? step.description}</p>
            </div>
          </li>
        ))}
      </ol>
      {next && !finished ? (
        <Link className="button" href={next.href}>
          Continuar en el paso{" "}
          {progress.steps.findIndex(({ key }) => key === next.key) + 1}:{" "}
          {next.title}
        </Link>
      ) : null}
    </section>
  );
}
