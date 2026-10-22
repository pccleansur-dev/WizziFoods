import { describe, expect, it } from "vitest";

import {
  parseGrantSupportAccessRequest,
  parseRevokeSupportAccessRequest
} from "./support-access-input.js";

describe("support access input", () => {
  it("normalizes a bounded grant request", () => {
    expect(
      parseGrantSupportAccessRequest({
        durationMinutes: 60,
        reason: "  Diagnóstico solicitado  ",
        supportUserId: "b1000000-0000-4000-8000-000000000001"
      })
    ).toEqual({
      durationMinutes: 60,
      reason: "Diagnóstico solicitado",
      supportUserId: "b1000000-0000-4000-8000-000000000001"
    });
  });

  it.each([
    null,
    {},
    {
      durationMinutes: 60,
      reason: "Diagnóstico solicitado",
      supportUserId: "support-from-client"
    },
    {
      durationMinutes: 241,
      reason: "Diagnóstico solicitado",
      supportUserId: "b1000000-0000-4000-8000-000000000001"
    },
    {
      durationMinutes: 60,
      reason: "no",
      supportUserId: "b1000000-0000-4000-8000-000000000001"
    },
    {
      durationMinutes: 60,
      reason: "Diagnóstico solicitado",
      supportUserId: "b1000000-0000-4000-8000-000000000001",
      tenantId: "attacker-controlled"
    }
  ])("rejects malformed or authority-bearing grant data", (input) => {
    expect(() => parseGrantSupportAccessRequest(input)).toThrow(
      "Datos de autorización de soporte inválidos."
    );
  });

  it("normalizes a revocation reason and rejects extra authority", () => {
    expect(
      parseRevokeSupportAccessRequest({ reason: "  Trabajo finalizado  " })
    ).toEqual({ reason: "Trabajo finalizado" });
    expect(() =>
      parseRevokeSupportAccessRequest({
        reason: "Trabajo finalizado",
        tenantId: "attacker-controlled"
      })
    ).toThrow("Datos de revocación de soporte inválidos.");
  });
});
