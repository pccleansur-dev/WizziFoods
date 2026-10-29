import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const setSession = vi.fn();
vi.mock("../../../../auth/supabase-server", () => ({
  createAuthServerClient: async () => ({ auth: { setSession } })
}));

const { POST } = await import("./route");

const token = "a".repeat(40);
function post(body: unknown, origin: string | null = "http://negocio.test") {
  return new NextRequest("http://negocio.test/auth/invitacion/sesion", {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      host: "negocio.test",
      ...(origin ? { origin } : {})
    },
    method: "POST"
  });
}

describe("POST /auth/invitacion/sesion", () => {
  beforeEach(() => setSession.mockReset());

  it("refuses a request that does not come from the same origin", async () => {
    const response = await POST(
      post({ accessToken: token, refreshToken: token }, "http://otro.test")
    );

    expect(response.status).toBe(403);
    expect(setSession).not.toHaveBeenCalled();
  });

  it("refuses malformed tokens before talking to Auth", async () => {
    for (const body of [
      {},
      { accessToken: token },
      { accessToken: token, refreshToken: "corto" },
      { accessToken: "con espacios y <script>", refreshToken: token }
    ]) {
      expect((await POST(post(body))).status).toBe(400);
    }
    expect(setSession).not.toHaveBeenCalled();
  });

  it("opens the session with valid tokens", async () => {
    setSession.mockResolvedValue({ error: null });

    const response = await POST(
      post({ accessToken: token, refreshToken: "cma47qto7plf" })
    );

    expect(response.status).toBe(200);
    expect(setSession).toHaveBeenCalledWith({
      access_token: token,
      refresh_token: "cma47qto7plf"
    });
  });

  it("answers 401 when Auth rejects the session", async () => {
    setSession.mockResolvedValue({ error: { message: "invalid" } });

    const response = await POST(
      post({ accessToken: token, refreshToken: token })
    );

    expect(response.status).toBe(401);
  });
});
