import { describe, expect, it, vi } from "vitest";

import {
  FakeGoogleOidcGateway,
  GoogleExchangeError,
  HttpGoogleOidcGateway
} from "./google-oidc.gateway.js";

const options = {
  clientId: "client-id",
  clientSecret: "client-secret",
  now: () => 1_000_000_000_000,
  redirectUri: "https://api.example.test/v1/diner-auth/google/callback"
};

function idToken(claims: Record<string, unknown>): string {
  const part = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "RS256" })}.${part(claims)}.signature`;
}

const valid = {
  aud: "client-id",
  email: "ana@example.com",
  email_verified: true,
  exp: 1_000_000_600,
  iss: "https://accounts.google.com",
  sub: "1234567890"
};

function gatewayReturning(claims: Record<string, unknown>, ok = true) {
  const fetch = vi.fn().mockResolvedValue({
    json: () => Promise.resolve({ id_token: idToken(claims) }),
    ok
  });
  return { fetch, gateway: new HttpGoogleOidcGateway({ ...options, fetch }) };
}

describe("HttpGoogleOidcGateway", () => {
  it("asks only for openid and email and carries the signed state", () => {
    const url = new URL(
      new HttpGoogleOidcGateway(options).authorizeUrl("signed.state")
    );
    expect(url.origin + url.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth"
    );
    expect(url.searchParams.get("scope")).toBe("openid email");
    expect(url.searchParams.get("state")).toBe("signed.state");
    expect(url.searchParams.get("client_id")).toBe("client-id");
    expect(url.searchParams.get("redirect_uri")).toBe(options.redirectUri);
  });

  it("exchanges the code server to server and keeps only sub and email", async () => {
    const { fetch, gateway } = gatewayReturning(valid);
    await expect(gateway.exchange("the-code")).resolves.toEqual({
      email: "ana@example.com",
      emailVerified: true,
      sub: "1234567890"
    });
    const [url, init] = fetch.mock.calls[0] as [string, { body: string }];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    expect(new URLSearchParams(init.body).get("code")).toBe("the-code");
    expect(new URLSearchParams(init.body).get("grant_type")).toBe(
      "authorization_code"
    );
  });

  it("marks an unverified email as such", async () => {
    const { gateway } = gatewayReturning({ ...valid, email_verified: false });
    await expect(gateway.exchange("c")).resolves.toMatchObject({
      emailVerified: false
    });
  });

  it.each([
    ["another audience", { aud: "someone-else" }],
    ["another issuer", { iss: "https://evil.test" }],
    ["an expired token", { exp: 1_000_000_000 - 1 }],
    ["no subject", { sub: "" }]
  ])("refuses %s", async (_label, change) => {
    const { gateway } = gatewayReturning({ ...valid, ...change });
    await expect(gateway.exchange("c")).rejects.toBeInstanceOf(
      GoogleExchangeError
    );
  });

  it("refuses when Google rejects the code", async () => {
    const { gateway } = gatewayReturning(valid, false);
    await expect(gateway.exchange("c")).rejects.toBeInstanceOf(
      GoogleExchangeError
    );
  });
});

describe("FakeGoogleOidcGateway", () => {
  const fake = new FakeGoogleOidcGateway("http://localhost:3001/cb");

  it("points at its own page and accepts fake:<email> only", async () => {
    expect(fake.authorizeUrl("s.t")).toBe(
      "http://localhost:3001/v1/dev/fake-google/authorize?state=s.t"
    );
    await expect(fake.exchange("fake:Ana@Example.com")).resolves.toEqual({
      email: "ana@example.com",
      emailVerified: true,
      sub: "fake-ana@example.com"
    });
    await expect(fake.exchange("real-code")).rejects.toBeInstanceOf(
      GoogleExchangeError
    );
    await expect(fake.exchange("fake:not-an-email")).rejects.toBeInstanceOf(
      GoogleExchangeError
    );
  });
});
