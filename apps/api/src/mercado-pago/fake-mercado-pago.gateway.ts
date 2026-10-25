import { randomBytes } from "node:crypto";

import type { ProviderPaymentSnapshot } from "@platform/contracts";

import {
  MercadoPagoGatewayError,
  type CreatePaymentInput,
  type MercadoPagoGateway,
  type OAuthTokens,
  type RefundPaymentInput
} from "./mercado-pago.gateway.js";

type FakePayment = {
  amountCents: number;
  externalReference: string;
  id: string;
  refundedCents: number;
  status: string;
  statusDetail: string | null;
  updatedAt: Date;
  userId: string;
};

export type FakeChange = { dataId: string; userId: string };

/**
 * A Mercado Pago stand-in for development and tests: it keeps payments in memory per
 * seller, answers like the provider does (a seller never sees another seller's
 * payment, an idempotency key never repeats a payment) and announces every change so
 * the API's own webhook endpoint can be driven end to end. It is refused in
 * production by the configuration.
 */
export class FakeMercadoPagoGateway implements MercadoPagoGateway {
  readonly mode = "fake" as const;
  private readonly payments = new Map<string, FakePayment>();
  private readonly idempotent = new Map<string, string>();
  private counter = 5_550_000;

  constructor(
    private readonly options: {
      /** Called after every change, as the provider would notify. */
      onChange: (change: FakeChange) => void;
      /** The API's public OAuth callback; the consent screen lives next to it. */
      redirectUri: string;
    },
    private readonly now: () => Date = () => new Date()
  ) {}

  authorizationUrl(state: string): string {
    const origin = new URL(this.options.redirectUri).origin;
    return `${origin}/v1/dev/mercado-pago/authorize?state=${encodeURIComponent(state)}`;
  }

  async exchangeCode(code: string): Promise<OAuthTokens> {
    const match = /^fake-([0-9]{1,20})$/u.exec(code);
    if (!match) throw new MercadoPagoGatewayError("invalid code", 400);
    return this.tokensFor(match[1]!);
  }

  async refreshTokens(refreshToken: string): Promise<OAuthTokens> {
    const match = /^TESTREFRESH-([0-9]{1,20})-/u.exec(refreshToken);
    if (!match) throw new MercadoPagoGatewayError("invalid refresh token", 400);
    return this.tokensFor(match[1]!);
  }

  async createPayment(
    accessToken: string,
    input: CreatePaymentInput
  ): Promise<ProviderPaymentSnapshot> {
    const userId = this.userOf(accessToken);
    const key = `${userId}:${input.idempotencyKey}`;
    const existing = this.idempotent.get(key);
    if (existing) return this.snapshot(this.payments.get(existing)!);

    let status = "approved";
    let statusDetail: string | null = "accredited";
    if (input.method.kind === "sandbox") {
      if (input.method.outcome === "pending") {
        status = "pending";
        statusDetail = "pending_waiting_payment";
      } else if (input.method.outcome === "rejected") {
        status = "rejected";
        statusDetail = "cc_rejected_other_reason";
      }
    } else if (input.method.card.payerEmail.startsWith("rechazo@")) {
      status = "rejected";
      statusDetail = "cc_rejected_insufficient_amount";
    }
    const payment: FakePayment = {
      amountCents: input.amountCents,
      externalReference: input.externalReference,
      id: String(this.counter++),
      refundedCents: 0,
      status,
      statusDetail,
      updatedAt: this.now(),
      userId
    };
    this.payments.set(payment.id, payment);
    this.idempotent.set(key, payment.id);
    this.options.onChange({ dataId: payment.id, userId });
    return this.snapshot(payment);
  }

  async fetchPayment(
    accessToken: string,
    providerPaymentId: string
  ): Promise<ProviderPaymentSnapshot | null> {
    const payment = this.payments.get(providerPaymentId);
    if (!payment || payment.userId !== this.userOf(accessToken)) return null;
    return this.snapshot(payment);
  }

  async refundPayment(
    accessToken: string,
    input: RefundPaymentInput
  ): Promise<void> {
    const userId = this.userOf(accessToken);
    const key = `${userId}:refund:${input.idempotencyKey}`;
    if (this.idempotent.has(key)) return;
    const payment = this.payments.get(input.providerPaymentId);
    if (!payment || payment.userId !== userId) {
      throw new MercadoPagoGatewayError("payment not found", 404);
    }
    if (
      payment.status !== "approved" ||
      input.amountCents <= 0 ||
      input.amountCents > payment.amountCents - payment.refundedCents
    ) {
      throw new MercadoPagoGatewayError("refund not allowed", 400);
    }
    payment.refundedCents += input.amountCents;
    payment.updatedAt = this.now();
    this.idempotent.set(key, payment.id);
    this.options.onChange({ dataId: payment.id, userId });
  }

  /** Test and sandbox control: the provider decides later what a payment became. */
  simulate(
    providerPaymentId: string,
    change: {
      refundedCents?: number | undefined;
      status: string;
      statusDetail?: string | null | undefined;
    }
  ): void {
    const payment = this.payments.get(providerPaymentId);
    if (!payment) throw new MercadoPagoGatewayError("payment not found", 404);
    payment.status = change.status;
    payment.statusDetail = change.statusDetail ?? null;
    if (change.refundedCents !== undefined) {
      payment.refundedCents = Math.min(
        change.refundedCents,
        payment.amountCents
      );
    }
    payment.updatedAt = this.now();
    this.options.onChange({ dataId: payment.id, userId: payment.userId });
  }

  /** What the consent screen redirects back with. */
  codeFor(userId: string): string {
    return `fake-${userId}`;
  }

  /** A seller id for a new authorization: unique per connection, 9 digits. */
  newSellerId(): string {
    return String(100_000_000 + (randomBytes(4).readUInt32BE() % 899_999_999));
  }

  private tokensFor(userId: string): OAuthTokens {
    const suffix = randomBytes(6).toString("hex");
    return {
      accessToken: `TEST-${userId}-${suffix}`,
      expiresAt: new Date(this.now().getTime() + 6 * 3_600_000).toISOString(),
      liveMode: false,
      mpUserId: userId,
      publicKey: `TEST-public-key-${userId}`,
      refreshToken: `TESTREFRESH-${userId}-${suffix}`
    };
  }

  private userOf(accessToken: string): string {
    const match = /^TEST-([0-9]{1,20})-[0-9a-f]+$/u.exec(accessToken);
    if (!match) throw new MercadoPagoGatewayError("invalid access token", 401);
    return match[1]!;
  }

  private snapshot(payment: FakePayment): ProviderPaymentSnapshot {
    return {
      amountCents: payment.amountCents,
      externalReference: payment.externalReference,
      providerPaymentId: payment.id,
      refundedCents:
        payment.status === "refunded"
          ? payment.amountCents
          : payment.refundedCents,
      status: payment.status,
      statusDetail: payment.statusDetail,
      updatedAt: payment.updatedAt.toISOString()
    };
  }
}
