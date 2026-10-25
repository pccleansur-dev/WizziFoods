import { createHash, randomBytes } from "node:crypto";

import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException
} from "@nestjs/common";
import {
  parseMercadoPagoNotification,
  type DinerPaymentTarget,
  type MercadoPagoConnectResult,
  type OnlineCheckout,
  type OnlinePaymentView,
  type OnlineRefundRequest,
  type OnlineRefundResult,
  type PayOnlinePaymentRequest,
  type ProviderPaymentSnapshot,
  type ReconcileResult,
  type TenantScope
} from "@platform/contracts";
import type { MercadoPagoRepository } from "@platform/database";

import type { PaymentSecretSealer } from "../payment-methods/payment-secret-sealer.js";
import {
  MercadoPagoGatewayError,
  type MercadoPagoGateway
} from "./mercado-pago.gateway.js";
import { verifyWebhookSignature } from "./webhook-signature.js";

const method = "mercado_pago";
const oauthTtlSeconds = 600;
/** A token this close to expiring is refreshed before it is used. */
const refreshMarginMs = 5 * 60_000;

type StoredTokens = {
  accessToken: string;
  expiresAt: string;
  refreshToken: string;
};

export type WebhookInput = {
  body: unknown;
  /** The `data.id` query parameter, which is what the signature covers. */
  queryDataId: string | null;
  requestId: string | null;
  signature: string | null;
};

export type WebhookResult = {
  outcome:
    | "applied"
    | "duplicate"
    | "ignored"
    | "needs_refund"
    | "stale"
    | "unchanged"
    | "unknown_seller"
    | "amount_mismatch";
};

function databaseCode(error: unknown): string | null {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : null;
}

function key(scope: TenantScope): string {
  return `${scope.tenantId}:${scope.locationId}`;
}

export class MercadoPagoService {
  private readonly logger = new Logger(MercadoPagoService.name);
  private readonly refreshing = new Map<string, Promise<StoredTokens>>();

  constructor(
    private readonly repository: MercadoPagoRepository,
    private readonly sealer: PaymentSecretSealer | null,
    private readonly gateway: MercadoPagoGateway | null,
    private readonly options: {
      now?: () => Date;
      returnUrl: string;
      webhookSecret: string | null;
    }
  ) {}

  // Connection (OAuth per business) -----------------------------------------------------

  async startConnection(
    scope: TenantScope,
    requesterId: string
  ): Promise<MercadoPagoConnectResult> {
    const gateway = this.requireGateway();
    this.requireSealer();
    const state = randomBytes(32).toString("base64url");
    await this.repository.beginOAuth({
      requesterId,
      scope,
      stateHash: createHash("sha256").update(state).digest(),
      ttlSeconds: oauthTtlSeconds
    });
    return { authorizationUrl: gateway.authorizationUrl(state) };
  }

  /** Where the browser lands after the authorization, with the result in the query. */
  async completeConnection(code: string, state: string): Promise<string> {
    const target = new URL(this.options.returnUrl);
    try {
      const gateway = this.requireGateway();
      const sealer = this.requireSealer();
      const consumed = await this.repository.consumeOAuthState(
        createHash("sha256").update(state).digest()
      );
      const tokens = await gateway.exchangeCode(code);
      await this.repository.finishConnection({
        liveMode: tokens.liveMode,
        mpUserId: tokens.mpUserId,
        publicKey: tokens.publicKey,
        requesterId: consumed.requesterId,
        scope: consumed.scope,
        sealed: sealer.seal(
          JSON.stringify({
            accessToken: tokens.accessToken,
            expiresAt: tokens.expiresAt,
            refreshToken: tokens.refreshToken
          } satisfies StoredTokens),
          consumed.scope,
          method
        )
      });
      target.searchParams.set("mp", "connected");
    } catch (error) {
      const failure = databaseCode(error);
      this.logger.warn(
        `Mercado Pago connection failed (${failure ?? (error as Error).name})`
      );
      target.searchParams.set(
        "mp",
        failure === "PT251"
          ? "in_use"
          : failure === "PT250"
            ? "expired"
            : "error"
      );
    }
    return target.toString();
  }

  async disconnect(scope: TenantScope, requesterId: string): Promise<void> {
    await this.repository.disconnect({ requesterId, scope });
  }

  // Diner checkout ----------------------------------------------------------------------------

  async startPayment(
    scope: TenantScope,
    target: DinerPaymentTarget
  ): Promise<OnlineCheckout> {
    const gateway = this.requireGateway();
    const stored = await this.repository.readCredentials(scope);
    if (!stored) throw this.notConnected();
    const payment = await this.repository.beginPayment({ ...target, scope });
    return {
      mode: gateway.mode === "fake" ? "sandbox" : "live",
      payment,
      publicKey: stored.publicKey
    };
  }

  async pay(
    scope: TenantScope,
    request: PayOnlinePaymentRequest
  ): Promise<OnlinePaymentView> {
    const gateway = this.requireGateway();
    if (request.method.kind === "sandbox" && gateway.mode !== "fake") {
      throw new BadRequestException({
        error: {
          code: "SANDBOX_NOT_AVAILABLE",
          message: "El pago de prueba no está disponible."
        }
      });
    }
    const attempt = await this.repository.beginPayment({
      intentId: request.intentId,
      scope,
      token: request.token
    });
    // Only a fresh attempt reaches the provider: a retry never charges twice.
    if (attempt.status === "created") {
      const credential = await this.credential(scope);
      const snapshot = await this.guard(() =>
        gateway.createPayment(credential.accessToken, {
          amountCents: attempt.amountCents,
          description: "Pedido en mesa",
          externalReference: attempt.externalReference,
          idempotencyKey: attempt.paymentId,
          method: request.method
        })
      );
      await this.apply(scope, attempt.paymentId, snapshot, "pay");
    }
    return this.repository.paymentView({
      intentId: request.intentId,
      scope,
      token: request.token
    });
  }

  status(
    scope: TenantScope,
    target: DinerPaymentTarget
  ): Promise<OnlinePaymentView> {
    return this.repository.paymentView({ ...target, scope });
  }

  // Webhook -----------------------------------------------------------------------------------------

  async handleWebhook(input: WebhookInput): Promise<WebhookResult> {
    if (!this.options.webhookSecret || !this.gateway) {
      throw this.unavailable();
    }
    const notification = parseMercadoPagoNotification(input.body);
    // The signature covers the id the provider put in the query (or, failing that,
    // the body's); it is checked before anything is looked up or stored.
    const signedId = input.queryDataId ?? notification?.dataId ?? null;
    if (
      !verifyWebhookSignature({
        dataId: signedId,
        header: input.signature,
        now: this.options.now,
        requestId: input.requestId,
        secret: this.options.webhookSecret
      })
    ) {
      throw new UnauthorizedException({
        error: {
          code: "INVALID_WEBHOOK_SIGNATURE",
          message: "Firma inválida."
        }
      });
    }
    if (
      !notification ||
      (input.queryDataId && input.queryDataId !== notification.dataId)
    ) {
      throw new BadRequestException({
        error: { code: "INVALID_WEBHOOK", message: "Notificación inválida." }
      });
    }
    if (notification.topic !== "payment") return { outcome: "ignored" };

    const eventKey = `${notification.topic}:${notification.notificationId}`;
    const scope = await this.repository.resolveAccount(notification.userId);
    const claim = await this.repository.claimWebhookEvent({
      dataId: notification.dataId,
      eventKey,
      scope,
      topic: notification.topic
    });
    if (claim === "duplicate") return { outcome: "duplicate" };
    if (!scope) {
      await this.repository.finishWebhookEvent(eventKey, "unknown_seller");
      return { outcome: "unknown_seller" };
    }

    // From here a failure leaves the event unfinished: the provider retries it.
    const credential = await this.credential(scope);
    const snapshot = await this.guard(() =>
      this.gateway!.fetchPayment(credential.accessToken, notification.dataId)
    );
    let outcome: WebhookResult["outcome"] = "ignored";
    if (snapshot) {
      const result = await this.apply(
        scope,
        snapshot.externalReference,
        snapshot,
        "webhook"
      );
      outcome = result?.outcome ?? "ignored";
    }
    await this.repository.finishWebhookEvent(eventKey, outcome);
    await this.sweepRefunds();
    return { outcome };
  }

  // Refunds -----------------------------------------------------------------------------------------

  async refund(
    scope: TenantScope,
    staffId: string,
    sessionId: string,
    request: OnlineRefundRequest
  ): Promise<OnlineRefundResult> {
    const gateway = this.requireGateway();
    const prepared = await this.repository.prepareRefund({
      amountCents: request.amountCents,
      paymentId: request.paymentId,
      reason: request.reason,
      scope,
      sessionId,
      staffId
    });
    const credential = await this.credential(scope);
    // The command id is the provider's idempotency key: a retry cannot refund twice.
    await this.guard(() =>
      gateway.refundPayment(credential.accessToken, {
        amountCents: prepared.amountCents,
        idempotencyKey: request.commandId,
        providerPaymentId: prepared.providerPaymentId
      })
    );
    const snapshot = await this.guard(() =>
      gateway.fetchPayment(credential.accessToken, prepared.providerPaymentId)
    );
    if (!snapshot) throw this.gatewayFailure();
    const result = await this.repository.reconcile({
      paymentId: prepared.paymentId,
      scope,
      snapshot
    });
    return { paymentId: result.paymentId, refundedCents: result.refundedCents };
  }

  /** Returns the money of accredited payments whose order could not be served. */
  async sweepRefunds(limit = 10): Promise<void> {
    if (!this.gateway) return;
    let pending;
    try {
      pending = await this.repository.paymentsNeedingRefund(limit);
    } catch (error) {
      this.logger.warn(
        `Refund sweep failed to list (${(error as Error).name})`
      );
      return;
    }
    for (const item of pending) {
      try {
        await this.returnMoney(
          item.scope,
          item.paymentId,
          item.providerPaymentId
        );
      } catch (error) {
        this.logger.warn(
          `Automatic refund of ${item.paymentId} will be retried (${(error as Error).name})`
        );
      }
    }
  }

  // Internals ---------------------------------------------------------------------------------------

  /** Applies a provider snapshot; money that cannot buy an order goes back. */
  private async apply(
    scope: TenantScope,
    paymentId: string,
    snapshot: ProviderPaymentSnapshot,
    source: "pay" | "webhook"
  ): Promise<ReconcileResult | null> {
    let result: ReconcileResult;
    try {
      result = await this.repository.reconcile({ paymentId, scope, snapshot });
    } catch (error) {
      const code = databaseCode(error);
      // Not ours (another system's reference, or another business): nothing to do.
      if (source === "webhook" && (code === "PT201" || code === "PT253")) {
        return null;
      }
      throw error;
    }
    if (result.fulfillment === "needs_refund") {
      try {
        await this.returnMoney(
          scope,
          result.paymentId,
          snapshot.providerPaymentId
        );
      } catch (error) {
        this.logger.warn(
          `Automatic refund of ${result.paymentId} will be retried (${(error as Error).name})`
        );
      }
    }
    return result;
  }

  private async returnMoney(
    scope: TenantScope,
    paymentId: string,
    providerPaymentId: string
  ): Promise<void> {
    const gateway = this.requireGateway();
    const credential = await this.credential(scope);
    const before = await this.guard(() =>
      gateway.fetchPayment(credential.accessToken, providerPaymentId)
    );
    if (!before) return;
    const remaining = before.amountCents - before.refundedCents;
    if (remaining > 0) {
      await this.guard(() =>
        gateway.refundPayment(credential.accessToken, {
          amountCents: remaining,
          idempotencyKey: `auto-${paymentId}`,
          providerPaymentId
        })
      );
    }
    const after = await this.guard(() =>
      gateway.fetchPayment(credential.accessToken, providerPaymentId)
    );
    if (after) {
      await this.repository.reconcile({ paymentId, scope, snapshot: after });
    }
  }

  /** The business' access token, refreshed first when it is about to expire. */
  private async credential(scope: TenantScope): Promise<StoredTokens> {
    const sealer = this.requireSealer();
    const stored = await this.repository.readCredentials(scope);
    if (!stored) throw this.notConnected();
    const tokens = JSON.parse(
      sealer.open(stored.ciphertext, scope, method)
    ) as StoredTokens;
    const now = (this.options.now?.() ?? new Date()).getTime();
    if (Date.parse(tokens.expiresAt) - now > refreshMarginMs) return tokens;

    // One refresh at a time per business: the provider rotates the refresh token.
    const ongoing = this.refreshing.get(key(scope));
    if (ongoing) return ongoing;
    const refresh = (async () => {
      const gateway = this.requireGateway();
      const next = await this.guard(() =>
        gateway.refreshTokens(tokens.refreshToken)
      );
      const renewed: StoredTokens = {
        accessToken: next.accessToken,
        expiresAt: next.expiresAt,
        refreshToken: next.refreshToken
      };
      await this.repository.replaceCredentials(
        scope,
        sealer.seal(JSON.stringify(renewed), scope, method)
      );
      return renewed;
    })().finally(() => this.refreshing.delete(key(scope)));
    this.refreshing.set(key(scope), refresh);
    return refresh;
  }

  /** Provider failures reach callers as a generic bad gateway, never as detail. */
  private async guard<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (error instanceof MercadoPagoGatewayError) {
        this.logger.warn(
          `Mercado Pago call failed (${error.status ?? "network"})`
        );
        throw this.gatewayFailure();
      }
      throw error;
    }
  }

  private requireGateway(): MercadoPagoGateway {
    if (!this.gateway) throw this.unavailable();
    return this.gateway;
  }

  private requireSealer(): PaymentSecretSealer {
    if (!this.sealer) throw this.unavailable();
    return this.sealer;
  }

  private unavailable(): ServiceUnavailableException {
    return new ServiceUnavailableException({
      error: {
        code: "MERCADO_PAGO_UNAVAILABLE",
        message: "El pago online no está disponible en este entorno."
      }
    });
  }

  private notConnected(): ConflictException {
    return new ConflictException({
      error: {
        code: "MERCADO_PAGO_NOT_CONNECTED",
        message: "Este local todavía no conectó Mercado Pago."
      }
    });
  }

  private gatewayFailure(): BadGatewayException {
    return new BadGatewayException({
      error: {
        code: "MERCADO_PAGO_GATEWAY_ERROR",
        message: "No pudimos hablar con Mercado Pago. Intentá nuevamente."
      }
    });
  }
}
