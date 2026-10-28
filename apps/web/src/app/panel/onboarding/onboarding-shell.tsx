import Link from "next/link";
import type { ReactNode } from "react";

import { loadReadiness } from "../publicar/readiness";
import { OnboardingFrame } from "./onboarding-frame";
import { onboardingProgress, type OnboardingStepKey } from "./steps";

/**
 * Página completa de un paso del asistente: encabezado, marco con la barra de
 * pasos y el contenido. El estado de los pasos sale de la matriz de requisitos
 * del servidor; si no se puede leer, el contenido igual se muestra.
 */
export async function OnboardingShell({
  children,
  current
}: {
  children: ReactNode;
  current: OnboardingStepKey;
}) {
  const readiness = await loadReadiness();
  const progress = onboardingProgress(
    readiness.status === "ready" ? readiness.readiness : null
  );

  return (
    <main className="panel-shell">
      <header className="panel-header">
        <span className="platform-wordmark">Wizzi Foods</span>
        <Link className="button button--secondary" href="/panel">
          Volver al inicio
        </Link>
      </header>
      <OnboardingFrame current={current} progress={progress}>
        {children}
      </OnboardingFrame>
    </main>
  );
}
