import { PAYMENT_METHOD_KEYS } from "@platform/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PaymentMethodsManager } from "../pagos/payment-methods-manager";
import { TeamManager } from "./team-manager";

const sectorId = "f1000000-0000-4000-8000-000000000001";
const noop = () => Promise.reject(new Error("not used"));

describe("team manager", () => {
  const markup = renderToStaticMarkup(
    <TeamManager
      initialMembers={[
        {
          createdAt: "2026-10-24T00:00:00Z",
          displayName: "Ana",
          id: "f2000000-0000-4000-8000-000000000002",
          isActive: true,
          role: "waiter",
          sectorIds: [sectorId],
          username: "ana"
        }
      ]}
      onCommand={noop}
      sectors={[{ id: sectorId, name: "Terraza" }]}
    />
  );

  it("lists members with role, sectors and state", () => {
    expect(markup).toContain("Ana");
    expect(markup).toContain("Mozo");
    expect(markup).toContain("Terraza");
    expect(markup).toContain("Activo");
  });

  it("masks PIN entry and never renders hashes", () => {
    expect(markup).toContain('type="password"');
    expect(markup).toContain('autoComplete="new-password"');
    expect(markup).not.toMatch(/scrypt|pin_hash|pinHash/u);
  });
});

describe("payment methods manager", () => {
  const methods = PAYMENT_METHOD_KEYS.map((method) => ({
    available: method === "cash" || method === "mercado_pago",
    configured: method === "mercado_pago",
    enabled: method === "cash" || method === "mercado_pago",
    method,
    publicConfig:
      method === "mercado_pago" ? { publicKey: "APP_USR-public-1" } : {},
    updatedAt: "2026-10-24T00:00:00Z"
  }));
  const markup = renderToStaticMarkup(
    <PaymentMethodsManager initialMethods={methods} onCommand={noop} />
  );

  it("shows state and the public key only", () => {
    expect(markup).toContain("Efectivo");
    expect(markup).toContain("Mercado Pago");
    expect(markup).toContain("APP_USR-public-1");
    expect(markup).toContain("guardada, no se puede ver");
  });

  it("has no field that could carry a stored credential back", () => {
    const secretInput =
      markup.match(/<input[^>]*name="secret"[^>]*>/u)?.[0] ?? "";
    expect(secretInput).toContain('type="password"');
    expect(secretInput).not.toContain("value=");
  });
});
