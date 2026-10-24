import { parseReadinessReport } from "@platform/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ReadinessManager } from "./readiness-manager";

const noop = () => Promise.reject(new Error("not used"));

function report(raw: Record<string, unknown>) {
  const parsed = parseReadinessReport({
    blockers: [],
    published: null,
    team: { activeManagers: 0, activeMembers: 0 },
    warnings: [],
    ...raw
  });
  if (!parsed) throw new Error("fixture");
  return parsed;
}

describe("readiness manager", () => {
  it("explains each missing requirement and links to the step that fixes it", () => {
    const markup = renderToStaticMarkup(
      <ReadinessManager
        initialReadiness={report({
          blockers: ["FLOOR_NO_TABLES", "PAYMENT_NO_METHOD"],
          warnings: ["TEAM_EMPTY"]
        })}
        onCommand={noop}
      />
    );
    expect(markup).toContain("Dibujá el plano del salón");
    expect(markup).toContain('href="/panel/plano"');
    expect(markup).toContain('href="/panel/pagos"');
    expect(markup).toContain("Falta para publicar");
    expect(markup).toContain("Recomendado");
  });

  it("disables publishing while blockers remain but keeps simulation separate", () => {
    const markup = renderToStaticMarkup(
      <ReadinessManager
        initialReadiness={report({ blockers: ["FLOOR_NO_TABLES"] })}
        onCommand={noop}
      />
    );
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Publicar el negocio/u);
    expect(markup).toContain("Simular un pedido de prueba");
    expect(markup).toContain("no se mezclan");
  });

  it("enables publishing when every blocker is met", () => {
    const markup = renderToStaticMarkup(
      <ReadinessManager initialReadiness={report({})} onCommand={noop} />
    );
    expect(markup).not.toMatch(
      /<button[^>]*disabled=""[^>]*>Publicar el negocio/u
    );
  });

  it("shows the published state", () => {
    const markup = renderToStaticMarkup(
      <ReadinessManager
        initialReadiness={report({
          published: {
            at: "2026-10-24T10:00:00+00:00",
            by: "f3000000-0000-4000-8000-000000000003",
            revision: 1
          }
        })}
        onCommand={noop}
      />
    );
    expect(markup).toContain("El negocio está publicado");
  });
});
