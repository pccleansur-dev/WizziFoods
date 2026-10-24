import { describe, expect, it } from "vitest";

import {
  BLOCKER_CODES,
  READINESS_CODES,
  SANDBOX_STEPS,
  WARNING_CODES,
  describeReadiness,
  parsePublicationRequest,
  parseReadinessReport,
  parseReadinessView,
  parseSandboxRun
} from "./readiness.js";

const base = {
  blockers: [],
  published: null,
  team: { activeManagers: 0, activeMembers: 0 },
  warnings: []
};

describe("readiness matrix", () => {
  it("explains every requirement code and links to the step that fixes it", () => {
    for (const code of READINESS_CODES) {
      const [item] = describeReadiness([code]);
      expect(item?.code).toBe(code);
      expect(item?.message.length).toBeGreaterThan(20);
      expect(item?.href).toMatch(/^\/panel(\/[a-z]+)?$/u);
    }
  });

  it("sends each requirement to the onboarding screen that fixes it", () => {
    const hrefs = Object.fromEntries(
      READINESS_CODES.map((code) => [code, describeReadiness([code])[0]?.href])
    );
    expect(hrefs.PROFILE_MISSING).toBe("/panel/negocio");
    expect(hrefs.PROFILE_CONTACT_MISSING).toBe("/panel/negocio");
    expect(hrefs.CATALOG_NOT_PUBLISHED).toBe("/panel/carta");
    expect(hrefs.CATALOG_LANGUAGE_MISSING).toBe("/panel/carta");
    expect(hrefs.CATALOG_DRAFT_UNPUBLISHED).toBe("/panel/carta");
    expect(hrefs.CATALOG_IMPORTS_PENDING).toBe("/panel/carta");
  });

  it("separates blockers from warnings and never makes warnings block", () => {
    expect(
      BLOCKER_CODES.some((code) => WARNING_CODES.includes(code as never))
    ).toBe(false);
    const report = parseReadinessReport({
      ...base,
      warnings: ["TEAM_EMPTY", "CATALOG_IMPORTS_PENDING"]
    });
    expect(report?.ready).toBe(true);
    expect(report?.items.every((item) => item.severity === "warning")).toBe(
      true
    );
  });

  it("is not ready while any blocker remains", () => {
    const report = parseReadinessReport({
      ...base,
      blockers: ["FLOOR_NO_TABLES", "PAYMENT_NO_METHOD"]
    });
    expect(report?.ready).toBe(false);
    expect(report?.items.map((item) => item.code)).toEqual([
      "FLOOR_NO_TABLES",
      "PAYMENT_NO_METHOD"
    ]);
  });

  it("does not require staff to publish", () => {
    expect(
      (BLOCKER_CODES as readonly string[]).some((code) => /TEAM/u.test(code))
    ).toBe(false);
  });

  it("rejects unknown codes, misplaced severities and extra keys", () => {
    expect(parseReadinessReport({ ...base, blockers: ["NOPE"] })).toBeNull();
    expect(
      parseReadinessReport({ ...base, blockers: ["TEAM_EMPTY"] })
    ).toBeNull();
    expect(
      parseReadinessReport({ ...base, warnings: ["PAYMENT_NO_METHOD"] })
    ).toBeNull();
    expect(parseReadinessReport({ ...base, tenantId: "x" })).toBeNull();
    expect(parseReadinessReport(null)).toBeNull();
  });

  it("reports the publication when the business is live", () => {
    const published = {
      at: "2026-10-24T10:00:00Z",
      by: "f3000000-0000-4000-8000-000000000003",
      revision: 1
    };
    expect(parseReadinessReport({ ...base, published })?.published).toEqual(
      published
    );
    expect(
      parseReadinessReport({ ...base, published: { at: "x" } })
    ).toBeNull();
  });
});

describe("readiness view", () => {
  it("round-trips the report the API sends to the panel", () => {
    const report = parseReadinessReport({
      ...base,
      blockers: ["FLOOR_NO_TABLES"],
      warnings: ["TEAM_EMPTY"]
    });
    expect(parseReadinessView(JSON.parse(JSON.stringify(report)))).toEqual(
      report
    );
  });

  it("rebuilds the text from the matrix instead of trusting the server", () => {
    const report = parseReadinessReport({
      ...base,
      blockers: ["FLOOR_NO_TABLES"]
    });
    const view = JSON.parse(JSON.stringify(report));
    view.items[0].message = "<script>alert(1)</script>";
    expect(parseReadinessView(view)?.items[0]?.message).not.toContain("script");
  });

  it("rejects a view whose ready flag contradicts its blockers", () => {
    const report = parseReadinessReport({
      ...base,
      blockers: ["FLOOR_NO_TABLES"]
    });
    expect(parseReadinessView({ ...report, ready: true })).toBeNull();
    expect(parseReadinessView({ ...report, extra: 1 })).toBeNull();
    expect(
      parseReadinessView({ ...report, items: [{ code: "NOPE" }] })
    ).toBeNull();
    expect(parseReadinessView(null)).toBeNull();
  });
});

describe("publication request", () => {
  it("accepts only an empty body so the client cannot pick tenant or state", () => {
    expect(parsePublicationRequest({}).ok).toBe(true);
    expect(parsePublicationRequest(undefined).ok).toBe(true);
    expect(parsePublicationRequest({ tenantId: "x" }).ok).toBe(false);
    expect(parsePublicationRequest({ ready: true }).ok).toBe(false);
  });
});

describe("sandbox run", () => {
  const run = {
    namespace: "sandbox",
    reference: "SBX-0001",
    runId: "f3000000-0000-4000-8000-000000000003",
    steps: SANDBOX_STEPS.map((step) => ({ ok: true, step }))
  };

  it("parses a complete circuit in order", () => {
    expect(parseSandboxRun(run)?.steps).toHaveLength(SANDBOX_STEPS.length);
  });

  it("rejects runs outside the sandbox namespace or out of order", () => {
    expect(parseSandboxRun({ ...run, namespace: "production" })).toBeNull();
    expect(
      parseSandboxRun({ ...run, steps: [...run.steps].reverse() })
    ).toBeNull();
    expect(parseSandboxRun({ ...run, reference: "ORD-1" })).toBeNull();
  });
});
