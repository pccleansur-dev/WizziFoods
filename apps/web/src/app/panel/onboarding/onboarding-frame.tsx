import Link from "next/link";
import type { ReactNode } from "react";

import type { OnboardingProgress, OnboardingStepKey } from "./steps";

/**
 * Marco de cada pantalla del asistente: barra de pasos arriba, el contenido del
 * paso y Anterior / Continuar abajo. Continuar no bloquea: lo único que se
 * bloquea en toda la puesta en marcha es publicar el negocio.
 */
export function OnboardingFrame({
  children,
  current,
  progress
}: {
  children: ReactNode;
  current: OnboardingStepKey;
  progress: OnboardingProgress;
}) {
  const index = progress.steps.findIndex(({ key }) => key === current);
  const step = progress.steps[index];
  const previous = progress.steps[index - 1];
  const next = progress.steps[index + 1];

  return (
    <div className="onboarding">
      <nav
        aria-label="Pasos de la puesta en marcha"
        className="onboarding-steps"
      >
        <p className="onboarding-steps__summary">
          Paso {index + 1} de {progress.steps.length} · Avance{" "}
          {progress.percent}%
        </p>
        <ol>
          {progress.steps.map((item, position) => (
            <li
              className={`onboarding-step onboarding-step--${item.status}${
                item.key === current ? " onboarding-step--current" : ""
              }`}
              key={item.key}
            >
              <Link
                aria-current={item.key === current ? "step" : undefined}
                href={item.href}
              >
                <span aria-hidden="true" className="onboarding-step__mark">
                  {item.status === "done" ? "✓" : position + 1}
                </span>
                <span className="onboarding-step__title">{item.title}</span>
              </Link>
            </li>
          ))}
        </ol>
      </nav>

      {children}

      <footer className="onboarding-footer">
        {step && step.missing.length > 0 ? (
          <div className="onboarding-footer__missing" role="status">
            <strong>Falta para completar este paso:</strong>
            <ul>
              {step.missing.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="onboarding-footer__nav">
          {previous ? (
            <Link className="button button--secondary" href={previous.href}>
              ← Anterior
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <>
              <span className="onboarding-footer__hint">
                Guardá antes de continuar. Podés volver cuando quieras.
              </span>
              <Link className="button" href={next.href}>
                Continuar: {next.title} →
              </Link>
            </>
          ) : null}
        </div>
      </footer>
    </div>
  );
}
