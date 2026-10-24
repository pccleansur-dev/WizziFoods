import { parseReadinessReport } from "@platform/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OnboardingFrame } from "./onboarding-frame";
import { onboardingProgress } from "./steps";

const progress = onboardingProgress(
  parseReadinessReport({
    blockers: ["FLOOR_NO_TABLES"],
    published: null,
    team: { activeManagers: 0, activeMembers: 0 },
    warnings: ["TEAM_EMPTY"]
  })
);

function frame(current: Parameters<typeof OnboardingFrame>[0]["current"]) {
  return renderToStaticMarkup(
    <OnboardingFrame current={current} progress={progress}>
      <p>contenido</p>
    </OnboardingFrame>
  );
}

describe("onboarding frame", () => {
  it("shows every step as a link, marks the current one and says where the user is", () => {
    const markup = frame("salon");
    for (const title of [
      "Negocio",
      "Carta",
      "Salón y QR",
      "Pagos",
      "Equipo",
      "Probar y publicar"
    ]) {
      expect(markup).toContain(title);
    }
    expect(markup).toContain('href="/panel/plano"');
    expect(markup).toContain('aria-current="step"');
    expect(markup).toContain("Paso 3 de 6");
    expect(markup).toContain("contenido");
  });

  it("explains what is missing in the current step without blocking the way forward", () => {
    const markup = frame("salon");
    expect(markup).toContain("Falta para completar este paso");
    expect(markup).toContain("Dibujá el plano del salón");
    expect(markup).toContain('href="/panel/pagos"');
    expect(markup).not.toMatch(/<a[^>]*aria-disabled/u);
  });

  it("offers Previous and Next, except at the ends", () => {
    expect(frame("carta")).toContain('href="/panel/negocio"');
    expect(frame("carta")).toContain('href="/panel/plano"');
    expect(frame("negocio")).not.toContain("Anterior");
    expect(frame("publicar")).not.toContain("Continuar");
    expect(frame("publicar")).toContain("Anterior");
  });

  it("does not claim that continuing saves the screen", () => {
    expect(frame("carta")).toContain("Guardá antes de continuar");
  });
});
