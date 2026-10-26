export type GoogleIdentity = {
  email: string;
  emailVerified: boolean;
  sub: string;
};

/**
 * What the API needs from Google: where to send the diner and who comes back. Only
 * the `sub` and the email leave this boundary; tokens are never stored.
 */
export interface GoogleOidcGateway {
  authorizeUrl(state: string): string;
  exchange(code: string): Promise<GoogleIdentity>;
}

const issuers = new Set(["accounts.google.com", "https://accounts.google.com"]);

export class GoogleExchangeError extends Error {}

type FetchLike = (
  input: string,
  init: { body: string; headers: Record<string, string>; method: string }
) => Promise<{ json(): Promise<unknown>; ok: boolean }>;

/** Google's OpenID Connect authorization-code flow, server to server. */
export class HttpGoogleOidcGateway implements GoogleOidcGateway {
  constructor(
    private readonly options: {
      clientId: string;
      clientSecret: string;
      fetch?: FetchLike;
      now?: () => number;
      redirectUri: string;
    }
  ) {}

  authorizeUrl(state: string): string {
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", this.options.clientId);
    url.searchParams.set("redirect_uri", this.options.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email");
    url.searchParams.set("prompt", "select_account");
    url.searchParams.set("state", state);
    return url.toString();
  }

  async exchange(code: string): Promise<GoogleIdentity> {
    const send = this.options.fetch ?? (fetch as unknown as FetchLike);
    const response = await send("https://oauth2.googleapis.com/token", {
      body: new URLSearchParams({
        client_id: this.options.clientId,
        client_secret: this.options.clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: this.options.redirectUri
      }).toString(),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      method: "POST"
    });
    if (!response.ok) throw new GoogleExchangeError("Google refused the code");
    const body = (await response.json()) as { id_token?: unknown };
    if (typeof body.id_token !== "string") {
      throw new GoogleExchangeError("Google sent no identity");
    }
    // The token arrives over TLS straight from Google's token endpoint, which is
    // what OpenID Connect Core 3.1.3.7 accepts instead of checking the signature.
    const payload = body.id_token.split(".")[1];
    let claims: Record<string, unknown>;
    try {
      claims = JSON.parse(
        Buffer.from(payload ?? "", "base64url").toString("utf8")
      ) as Record<string, unknown>;
    } catch {
      throw new GoogleExchangeError("Google sent an unreadable identity");
    }
    const now = (this.options.now ?? Date.now)() / 1000;
    if (
      typeof claims.iss !== "string" ||
      !issuers.has(claims.iss) ||
      claims.aud !== this.options.clientId ||
      typeof claims.exp !== "number" ||
      claims.exp <= now ||
      typeof claims.sub !== "string" ||
      claims.sub.length === 0 ||
      typeof claims.email !== "string"
    ) {
      throw new GoogleExchangeError("Google sent an invalid identity");
    }
    return {
      email: claims.email,
      emailVerified: claims.email_verified === true,
      sub: claims.sub
    };
  }
}

/**
 * In-process stand-in for development and tests (refused in production). The "code"
 * is `fake:<email>`; the page that produces it is `FakeGoogleController`.
 */
export class FakeGoogleOidcGateway implements GoogleOidcGateway {
  constructor(private readonly redirectUri: string) {}

  authorizeUrl(state: string): string {
    const url = new URL("/v1/dev/fake-google/authorize", this.redirectUri);
    url.searchParams.set("state", state);
    return url.toString();
  }

  exchange(code: string): Promise<GoogleIdentity> {
    const email = code.startsWith("fake:") ? code.slice(5).trim() : "";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(email)) {
      return Promise.reject(new GoogleExchangeError("unknown fake code"));
    }
    return Promise.resolve({
      email: email.toLowerCase(),
      emailVerified: true,
      sub: `fake-${email.toLowerCase()}`
    });
  }
}
