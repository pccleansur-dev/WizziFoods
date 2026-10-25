import type {
  OnlinePaymentMethodInput,
  ProviderPaymentSnapshot
} from "@platform/contracts";

export type OAuthTokens = {
  accessToken: string;
  expiresAt: string;
  liveMode: boolean;
  mpUserId: string;
  publicKey: string;
  refreshToken: string;
};

export type CreatePaymentInput = {
  amountCents: number;
  description: string;
  externalReference: string;
  /** The same key never creates a second payment at the provider. */
  idempotencyKey: string;
  method: OnlinePaymentMethodInput;
};

export type RefundPaymentInput = {
  amountCents: number;
  idempotencyKey: string;
  providerPaymentId: string;
};

/** Failure talking to the provider; never carries the provider's body or a token. */
export class MercadoPagoGatewayError extends Error {
  constructor(
    message: string,
    readonly status: number | null
  ) {
    super(message);
    this.name = "MercadoPagoGatewayError";
  }
}

/**
 * Everything the API needs from Mercado Pago. `HttpMercadoPagoGateway` talks to the
 * real service; `FakeMercadoPagoGateway` is a deterministic simulator for development
 * and tests. Both answer with the same canonical snapshot, so the rest of the code
 * cannot tell them apart.
 */
export interface MercadoPagoGateway {
  readonly mode: "fake" | "live";
  authorizationUrl(state: string): string;
  createPayment(
    accessToken: string,
    input: CreatePaymentInput
  ): Promise<ProviderPaymentSnapshot>;
  exchangeCode(code: string): Promise<OAuthTokens>;
  /** Null when the payment does not exist for this seller (or is not ours). */
  fetchPayment(
    accessToken: string,
    providerPaymentId: string
  ): Promise<ProviderPaymentSnapshot | null>;
  refreshTokens(refreshToken: string): Promise<OAuthTokens>;
  refundPayment(accessToken: string, input: RefundPaymentInput): Promise<void>;
}
