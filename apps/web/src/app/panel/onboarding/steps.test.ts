import { parseReadinessReport } from "@platform/contracts";
import { describe, expect, it } from "vitest";

import { ONBOARDING_STEPS, onboardingProgress } from "./steps";

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

const statuses = (progress: ReturnType<typeof onboardingProgress>) =>
  Object.fromEntries(progress.steps.map((step) => [step.key, step.status]));

describe("onboarding steps", () => {
  it("lists the six screens in order, each with its own address", () => {
    expect(ONBOARDING_STEPS.map(({ key }) => key)).toEqual([
      "negocio",
      "carta",
      "salon",
      "pagos",
      "equipo",
      "publicar"
    ]);
    expect(new Set(ONBOARDING_STEPS.map(({ href }) => href)).size).toBe(6);
  });

  it("starts a new business at the first step with publishing blocked", () => {
    const progress = onboardingProgress(
      report({
        blockers: [
          "PROFILE_MISSING",
          "CATALOG_NOT_PUBLISHED",
          "FLOOR_NO_TABLES"
        ],
        warnings: ["TEAM_EMPTY"]
      })
    );
    expect(statuses(progress)).toEqual({
      carta: "pending",
      equipo: "optional",
      negocio: "pending",
      pagos: "done",
      publicar: "blocked",
      salon: "pending"
    });
    expect(progress.next).toBe("negocio");
    expect(progress.percent).toBe(20);
  });

  it("moves the next step forward as requirements are met", () => {
    const progress = onboardingProgress(
      report({ blockers: ["FLOOR_NO_TABLES"], warnings: ["TEAM_EMPTY"] })
    );
    expect(progress.next).toBe("salon");
    expect(progress.steps.find(({ key }) => key === "salon")?.missing).toEqual([
      "Dibujá el plano del salón con al menos una mesa."
    ]);
    expect(progress.percent).toBe(60);
  });

  it("unlocks publishing once every minimum is met, and team stays optional", () => {
    const progress = onboardingProgress(report({ warnings: ["TEAM_EMPTY"] }));
    expect(statuses(progress).publicar).toBe("pending");
    expect(statuses(progress).equipo).toBe("optional");
    expect(progress.next).toBe("publicar");
  });

  it("shows everything done after publishing", () => {
    const progress = onboardingProgress(
      report({
        published: {
          at: "2026-10-24T10:00:00+00:00",
          by: "f3000000-0000-4000-8000-000000000003",
          revision: 1
        }
      })
    );
    expect(Object.values(statuses(progress))).toEqual(Array(6).fill("done"));
    expect(progress.percent).toBe(100);
  });

  it("keeps warnings as notes of their step without blocking it", () => {
    const progress = onboardingProgress(
      report({ warnings: ["CATALOG_IMPORTS_PENDING", "TEAM_EMPTY"] })
    );
    const carta = progress.steps.find(({ key }) => key === "carta");
    expect(carta?.status).toBe("done");
    expect(carta?.notes).toHaveLength(1);
  });

  it("falls back to the first step when readiness cannot be read", () => {
    const progress = onboardingProgress(null);
    expect(progress.next).toBe("negocio");
    expect(progress.percent).toBe(0);
    expect(progress.steps.every(({ status }) => status !== "done")).toBe(true);
  });
});
