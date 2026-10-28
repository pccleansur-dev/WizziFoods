import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { exchangeCodeForSession } = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn()
}));

vi.mock("@platform/config", () => ({
  readWebAuthConfig: () => ({
    appUrl: "https://app-carta.wizzi.com.ar"
  })
}));

vi.mock("../../../auth/supabase-server", () => ({
  createAuthServerClient: async () => ({
    auth: { exchangeCodeForSession }
  })
}));

import { GET } from "./route";

describe("GET /auth/callback", () => {
  beforeEach(() => {
    exchangeCodeForSession.mockReset();
  });

  it("redirects successful OAuth logins through the configured public app URL", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });
    const request = new NextRequest(
      "http://0.0.0.0:3000/auth/callback?code=valid&next=/acceso/continuar"
    );

    const response = await GET(request);

    expect(response.headers.get("location")).toBe(
      "https://app-carta.wizzi.com.ar/acceso/continuar"
    );
  });

  it("redirects failed OAuth logins through the configured public app URL", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: new Error("invalid") });
    const request = new NextRequest(
      "http://0.0.0.0:3000/auth/callback?code=invalid"
    );

    const response = await GET(request);

    expect(response.headers.get("location")).toBe(
      "https://app-carta.wizzi.com.ar/acceso?error=no-se-pudo-validar"
    );
  });
});
