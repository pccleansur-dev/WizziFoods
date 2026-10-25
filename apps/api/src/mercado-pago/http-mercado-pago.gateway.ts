import {
  parseProviderPaymentSnapshot,
  providerPaymentStatuses,
  type ProviderPaymentSnapshot
} from "@platform/contracts";

import {
  MercadoPagoGatewayError,
  type CreatePaymentInput,
  type MercadoPagoGateway,
  type OAuthTokens,
  type RefundPaymentInput
} from "./mercado-pago.gateway.js";

type Fetch = typeof fetch;

export type HttpGatewayOptions = {
  apiBase?: string;
  authBase?: string;
  clientId: string;
  clientSecret: string;
  fetch?: Fetch;
  now?: () => Date;
  redirectUri: string;
};

const defaultApiBase = "https://api.mercadopago.com";
const defaultAuthBase = "https://auth.mercadopago.com.ar";

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Pesos with decimals, as the provider reports them, to whole cents. */
function toCents(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value * 100)
    : null;
}

/** Real Mercado Pago over REST. Tokens only ever travel in the Authorization header. */
export class HttpMercadoPagoGateway implements MercadoPagoGateway {
  readonly mode = "live" as const;
  private readonly apiBase: string;
  private readonly authBase: string;
  private readonly send: Fetch;
  private readonly now: () => Date;

  constructor(private readonly options: HttpGatewayOptions) {
    this.apiBase = options.apiBase ?? defaultApiBase;
    this.authBase = options.authBase ?? defaultAuthBase;
    this.send = options.fetch ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  authorizationUrl(state: string): string {
    const url = new URL("/authorization", this.authBase);
    url.searchParams.set("client_id", this.options.clientId);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("platform_id", "mp");
    url.searchParams.set("state", state);
    url.searchParams.set("redirect_uri", this.options.redirectUri);
    return url.toString();
  }

  exchangeCode(code: string): Promise<OAuthTokens> {
    return this.token({
      client_id: this.options.clientId,
      client_secret: this.options.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: this.options.redirectUri
    });
  }

  refreshTokens(refreshToken: string): Promise<OAuthTokens> {
    return this.token({
      client_id: this.options.clientId,
      client_secret: this.options.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken
    });
  }

  async createPayment(
    accessToken: string,
    input: CreatePaymentInput
  ): Promise<ProviderPaymentSnapshot> {
    if (input.method.kind !== "card") {
      throw new MercadoPagoGatewayError("only card payments are accepted", 400);
    }
    const card = input.method.card;
    const body = {
      description: input.description,
      external_reference: input.externalReference,
      installments: card.installments,
      ...(card.issuerId ? { issuer_id: card.issuerId } : {}),
      payer: { email: card.payerEmail },
      payment_method_id: card.paymentMethodId,
      token: card.token,
      transaction_amount: input.amountCents / 100
    };
    const response = await this.call(accessToken, "POST", "/v1/payments", {
      body,
      idempotencyKey: input.idempotencyKey
    });
    const snapshot = this.snapshot(response);
    if (!snapshot) {
      throw new MercadoPagoGatewayError("unexpected payment answer", 502);
    }
    return snapshot;
  }

  async fetchPayment(
    accessToken: string,
    providerPaymentId: string
  ): Promise<ProviderPaymentSnapshot | null> {
    if (!/^[0-9A-Za-z_-]{1,64}$/u.test(providerPaymentId)) return null;
    try {
      const response = await this.call(
        accessToken,
        "GET",
        `/v1/payments/${providerPaymentId}`
      );
      return this.snapshot(response);
    } catch (error) {
      if (error instanceof MercadoPagoGatewayError && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  async refundPayment(
    accessToken: string,
    input: RefundPaymentInput
  ): Promise<void> {
    await this.call(
      accessToken,
      "POST",
      `/v1/payments/${encodeURIComponent(input.providerPaymentId)}/refunds`,
      {
        body: { amount: input.amountCents / 100 },
        idempotencyKey: input.idempotencyKey
      }
    );
  }

  private async token(body: Record<string, string>): Promise<OAuthTokens> {
    const response = await this.call(null, "POST", "/oauth/token", { body });
    const root = record(response);
    const expiresIn = root?.expires_in;
    if (
      !root ||
      typeof root.access_token !== "string" ||
      typeof root.refresh_token !== "string" ||
      typeof root.public_key !== "string" ||
      (typeof root.user_id !== "number" && typeof root.user_id !== "string") ||
      typeof expiresIn !== "number"
    ) {
      throw new MercadoPagoGatewayError("unexpected token answer", 502);
    }
    return {
      accessToken: root.access_token,
      expiresAt: new Date(
        this.now().getTime() + expiresIn * 1000
      ).toISOString(),
      liveMode: root.live_mode === true,
      mpUserId: String(root.user_id),
      publicKey: root.public_key,
      refreshToken: root.refresh_token
    };
  }

  /** Turns the provider's payment into the canonical snapshot, or null when not ours. */
  private snapshot(value: unknown): ProviderPaymentSnapshot | null {
    const root = record(value);
    if (!root) return null;
    const amountCents = toCents(root.transaction_amount);
    const refundedCents = toCents(root.transaction_amount_refunded ?? 0);
    const status = String(root.status);
    const updated = new Date(String(root.date_last_updated ?? ""));
    if (
      amountCents === null ||
      refundedCents === null ||
      !(providerPaymentStatuses as readonly string[]).includes(status) ||
      Number.isNaN(updated.getTime())
    ) {
      return null;
    }
    return parseProviderPaymentSnapshot({
      amountCents,
      externalReference: root.external_reference,
      providerPaymentId: String(root.id),
      refundedCents: status === "refunded" ? amountCents : refundedCents,
      status,
      statusDetail:
        typeof root.status_detail === "string" && root.status_detail.length > 0
          ? root.status_detail.slice(0, 100)
          : null,
      updatedAt: updated.toISOString()
    });
  }

  private async call(
    accessToken: string | null,
    method: "GET" | "POST",
    path: string,
    options: { body?: unknown; idempotencyKey?: string } = {}
  ): Promise<unknown> {
    const headers: Record<string, string> = {
      accept: "application/json",
      "content-type": "application/json"
    };
    if (accessToken) headers.authorization = `Bearer ${accessToken}`;
    if (options.idempotencyKey) {
      headers["x-idempotency-key"] = options.idempotencyKey;
    }
    let response: Response;
    try {
      response = await this.send(`${this.apiBase}${path}`, {
        ...(options.body === undefined
          ? {}
          : { body: JSON.stringify(options.body) }),
        headers,
        method,
        signal: AbortSignal.timeout(15_000)
      });
    } catch {
      throw new MercadoPagoGatewayError("Mercado Pago is unreachable", null);
    }
    if (!response.ok) {
      // The provider's body can echo request data: never forward it.
      throw new MercadoPagoGatewayError(
        `Mercado Pago answered ${response.status}`,
        response.status
      );
    }
    try {
      return await response.json();
    } catch {
      throw new MercadoPagoGatewayError("unreadable answer", 502);
    }
  }
}
