import { describe, expect, it, vi } from "vitest";

import { FakeMercadoPagoGateway } from "./fake-mercado-pago.gateway.js";
import { createFakeWebhookSender } from "./fake-webhook-sender.js";
import { HttpMercadoPagoGateway } from "./http-mercado-pago.gateway.js";
import { MercadoPagoGatewayError } from "./mercado-pago.gateway.js";
import { verifyWebhookSignature } from "./webhook-signature.js";

const reference = "2e000000-0000-4000-8000-000000000001";
const clock = () => new Date("2026-10-25T12:00:00.000Z");

function fake() {
  const changes: { dataId: string; userId: string }[] = [];
  const gateway = new FakeMercadoPagoGateway(
    {
      onChange: (change) => changes.push(change),
      redirectUri: "http://localhost:3001/v1/payments/mercado-pago/callback"
    },
    clock
  );
  return { changes, gateway };
}

const card = {
  card: {
    installments: 1,
    issuerId: null,
    payerEmail: "ana@example.com",
    paymentMethodId: "visa",
    token: "cardtoken123456"
  },
  kind: "card" as const
};

describe("fake Mercado Pago gateway", () => {
  it("grants every authorization with a distinct seller", async () => {
    const { gateway } = fake();
    expect(gateway.authorizationUrl("state-1")).toBe(
      "http://localhost:3001/v1/dev/mercado-pago/authorize?state=state-1"
    );
    const seller = gateway.newSellerId();
    const tokens = await gateway.exchangeCode(gateway.codeFor(seller));
    expect(tokens).toMatchObject({ liveMode: false, mpUserId: seller });
    await expect(gateway.exchangeCode("nope")).rejects.toBeInstanceOf(
      MercadoPagoGatewayError
    );
    const refreshed = await gateway.refreshTokens(tokens.refreshToken);
    expect(refreshed.mpUserId).toBe(seller);
    await expect(gateway.refreshTokens("x")).rejects.toBeInstanceOf(
      MercadoPagoGatewayError
    );
  });

  it("decides the outcome of a sandbox payment and announces it", async () => {
    const { changes, gateway } = fake();
    const { accessToken, mpUserId } = await gateway.exchangeCode("fake-111");
    const make = (outcome: "approved" | "pending" | "rejected", key: string) =>
      gateway.createPayment(accessToken, {
        amountCents: 25_000,
        description: "Pedido",
        externalReference: reference,
        idempotencyKey: key,
        method: { kind: "sandbox", outcome }
      });
    await expect(make("approved", "a")).resolves.toMatchObject({
      status: "approved",
      statusDetail: "accredited"
    });
    await expect(make("pending", "b")).resolves.toMatchObject({
      status: "pending"
    });
    await expect(make("rejected", "c")).resolves.toMatchObject({
      status: "rejected"
    });
    expect(changes).toHaveLength(3);
    expect(changes.every((change) => change.userId === mpUserId)).toBe(true);
  });

  it("never repeats a payment for the same idempotency key", async () => {
    const { changes, gateway } = fake();
    const { accessToken } = await gateway.exchangeCode("fake-111");
    const input = {
      amountCents: 1_000,
      description: "Pedido",
      externalReference: reference,
      idempotencyKey: "same",
      method: card
    };
    const first = await gateway.createPayment(accessToken, input);
    const second = await gateway.createPayment(accessToken, input);
    expect(second.providerPaymentId).toBe(first.providerPaymentId);
    expect(changes).toHaveLength(1);
  });

  it("rejects the test card that cannot pay", async () => {
    const { gateway } = fake();
    const { accessToken } = await gateway.exchangeCode("fake-111");
    await expect(
      gateway.createPayment(accessToken, {
        amountCents: 1_000,
        description: "Pedido",
        externalReference: reference,
        idempotencyKey: "k",
        method: {
          ...card,
          card: { ...card.card, payerEmail: "rechazo@example.com" }
        }
      })
    ).resolves.toMatchObject({
      status: "rejected",
      statusDetail: "cc_rejected_insufficient_amount"
    });
  });

  it("keeps sellers apart: one never sees or refunds the other's payment", async () => {
    const { gateway } = fake();
    const one = await gateway.exchangeCode("fake-111");
    const two = await gateway.exchangeCode("fake-222");
    const payment = await gateway.createPayment(one.accessToken, {
      amountCents: 1_000,
      description: "Pedido",
      externalReference: reference,
      idempotencyKey: "k",
      method: card
    });
    await expect(
      gateway.fetchPayment(two.accessToken, payment.providerPaymentId)
    ).resolves.toBeNull();
    await expect(
      gateway.refundPayment(two.accessToken, {
        amountCents: 100,
        idempotencyKey: "r",
        providerPaymentId: payment.providerPaymentId
      })
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      gateway.fetchPayment("not-a-token", payment.providerPaymentId)
    ).rejects.toMatchObject({ status: 401 });
  });

  it("refunds up to what was paid, once per key, and reports it", async () => {
    const { changes, gateway } = fake();
    const { accessToken } = await gateway.exchangeCode("fake-111");
    const payment = await gateway.createPayment(accessToken, {
      amountCents: 10_000,
      description: "Pedido",
      externalReference: reference,
      idempotencyKey: "k",
      method: card
    });
    const refund = (amountCents: number, key: string) =>
      gateway.refundPayment(accessToken, {
        amountCents,
        idempotencyKey: key,
        providerPaymentId: payment.providerPaymentId
      });
    await refund(4_000, "r1");
    await refund(4_000, "r1");
    expect(
      (await gateway.fetchPayment(accessToken, payment.providerPaymentId))
        ?.refundedCents
    ).toBe(4_000);
    await expect(refund(6_001, "r2")).rejects.toMatchObject({ status: 400 });
    await refund(6_000, "r3");
    expect(changes).toHaveLength(3);
  });

  it("lets the sandbox decide later what a payment became", async () => {
    const { gateway } = fake();
    const { accessToken } = await gateway.exchangeCode("fake-111");
    const pending = await gateway.createPayment(accessToken, {
      amountCents: 10_000,
      description: "Pedido",
      externalReference: reference,
      idempotencyKey: "k",
      method: { kind: "sandbox", outcome: "pending" }
    });
    gateway.simulate(pending.providerPaymentId, { status: "approved" });
    expect(
      await gateway.fetchPayment(accessToken, pending.providerPaymentId)
    ).toMatchObject({ status: "approved" });
    gateway.simulate(pending.providerPaymentId, { status: "refunded" });
    expect(
      await gateway.fetchPayment(accessToken, pending.providerPaymentId)
    ).toMatchObject({ refundedCents: 10_000, status: "refunded" });
    expect(() => gateway.simulate("nope", { status: "approved" })).toThrow();
  });
});

describe("fake webhook sender", () => {
  it("sends a payment notification the API accepts as signed", async () => {
    vi.useFakeTimers();
    const send = vi.fn(() => Promise.resolve(new Response("{}")));
    const secret = "webhook-secret-123456";
    createFakeWebhookSender({
      delayMs: 5,
      now: clock,
      secret,
      send: send as never,
      url: "http://127.0.0.1:3001/v1/webhooks/mercado-pago"
    })({ dataId: "5550001", userId: "1234567" });
    await vi.advanceTimersByTimeAsync(10);
    vi.useRealTimers();
    expect(send).toHaveBeenCalledTimes(1);
    const [url, init] = send.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      "http://127.0.0.1:3001/v1/webhooks/mercado-pago?data.id=5550001&type=payment"
    );
    const headers = init.headers as Record<string, string>;
    expect(
      verifyWebhookSignature({
        dataId: "5550001",
        header: headers["x-signature"],
        now: clock,
        requestId: headers["x-request-id"],
        secret
      })
    ).toBe(true);
    expect(JSON.parse(String(init.body))).toMatchObject({
      data: { id: "5550001" },
      type: "payment",
      user_id: "1234567"
    });
  });
});

describe("HTTP Mercado Pago gateway", () => {
  function http(answers: Response[]) {
    const calls: { init: RequestInit; url: string }[] = [];
    const fetcher = vi.fn((url: string | URL | Request, init?: RequestInit) => {
      calls.push({ init: init ?? {}, url: String(url) });
      return Promise.resolve(
        answers.shift() ?? new Response("{}", { status: 500 })
      );
    });
    const gateway = new HttpMercadoPagoGateway({
      clientId: "1234567890",
      clientSecret: "client-secret",
      fetch: fetcher as never,
      now: clock,
      redirectUri: "https://api.example.test/v1/payments/mercado-pago/callback"
    });
    return { calls, gateway };
  }
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status });

  it("builds the authorization link for the application", () => {
    const url = new URL(http([]).gateway.authorizationUrl("state-1"));
    expect(url.origin + url.pathname).toBe(
      "https://auth.mercadopago.com.ar/authorization"
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "1234567890",
      platform_id: "mp",
      redirect_uri:
        "https://api.example.test/v1/payments/mercado-pago/callback",
      response_type: "code",
      state: "state-1"
    });
  });

  it("exchanges and refreshes tokens", async () => {
    const answer = {
      access_token: "APP_USR-token",
      expires_in: 21_600,
      live_mode: true,
      public_key: "APP_USR-public",
      refresh_token: "TG-refresh",
      user_id: 1234567
    };
    const { calls, gateway } = http([json(answer), json(answer)]);
    await expect(gateway.exchangeCode("code-1")).resolves.toEqual({
      accessToken: "APP_USR-token",
      expiresAt: "2026-10-25T18:00:00.000Z",
      liveMode: true,
      mpUserId: "1234567",
      publicKey: "APP_USR-public",
      refreshToken: "TG-refresh"
    });
    await gateway.refreshTokens("TG-refresh");
    expect(calls[0]!.url).toBe("https://api.mercadopago.com/oauth/token");
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({
      code: "code-1",
      grant_type: "authorization_code"
    });
    expect(JSON.parse(String(calls[1]!.init.body))).toMatchObject({
      grant_type: "refresh_token",
      refresh_token: "TG-refresh"
    });
  });

  it("creates a card payment with the reference, the amount in pesos and an idempotency key", async () => {
    const { calls, gateway } = http([
      json({
        date_last_updated: "2026-10-25T09:00:00.000-03:00",
        external_reference: reference,
        id: 5550001,
        status: "approved",
        status_detail: "accredited",
        transaction_amount: 250,
        transaction_amount_refunded: 0
      })
    ]);
    await expect(
      gateway.createPayment("APP_USR-token", {
        amountCents: 25_000,
        description: "Pedido",
        externalReference: reference,
        idempotencyKey: "key-1",
        method: card
      })
    ).resolves.toEqual({
      amountCents: 25_000,
      externalReference: reference,
      providerPaymentId: "5550001",
      refundedCents: 0,
      status: "approved",
      statusDetail: "accredited",
      updatedAt: "2026-10-25T12:00:00.000Z"
    });
    const call = calls[0]!;
    const headers = call.init.headers as Record<string, string>;
    expect(call.url).toBe("https://api.mercadopago.com/v1/payments");
    expect(headers.authorization).toBe("Bearer APP_USR-token");
    expect(headers["x-idempotency-key"]).toBe("key-1");
    expect(JSON.parse(String(call.init.body))).toMatchObject({
      external_reference: reference,
      payment_method_id: "visa",
      token: "cardtoken123456",
      transaction_amount: 250
    });
  });

  it("refuses a sandbox payment and never forwards the provider's body", async () => {
    const { gateway } = http([
      json(
        { message: "secret detail", cause: [{ description: "card 4111" }] },
        400
      )
    ]);
    await expect(
      gateway.createPayment("t", {
        amountCents: 1_000,
        description: "Pedido",
        externalReference: reference,
        idempotencyKey: "k",
        method: { kind: "sandbox", outcome: "approved" }
      })
    ).rejects.toMatchObject({ status: 400 });
    const failure = await gateway
      .createPayment("t", {
        amountCents: 1_000,
        description: "Pedido",
        externalReference: reference,
        idempotencyKey: "k",
        method: card
      })
      .catch((error: Error) => error);
    expect((failure as Error).message).not.toContain("secret detail");
    expect((failure as Error).message).not.toContain("4111");
  });

  it("turns a payment into a snapshot, or into nothing when it is not ours", async () => {
    const payment = {
      date_last_updated: "2026-10-25T09:00:00.000-03:00",
      external_reference: reference,
      id: 5550001,
      status: "refunded",
      status_detail: "refunded",
      transaction_amount: 100.5,
      transaction_amount_refunded: 100.5
    };
    const { gateway } = http([
      json(payment),
      json({ ...payment, external_reference: "order-1" }),
      json({ message: "not found" }, 404),
      json({ ...payment, status: "weird" })
    ]);
    await expect(gateway.fetchPayment("t", "5550001")).resolves.toMatchObject({
      amountCents: 10_050,
      refundedCents: 10_050,
      status: "refunded"
    });
    await expect(gateway.fetchPayment("t", "5550001")).resolves.toBeNull();
    await expect(gateway.fetchPayment("t", "5550001")).resolves.toBeNull();
    await expect(gateway.fetchPayment("t", "5550001")).resolves.toBeNull();
    await expect(gateway.fetchPayment("t", "../etc")).resolves.toBeNull();
  });

  it("refunds an amount in pesos with an idempotency key", async () => {
    const { calls, gateway } = http([json({ id: 1 })]);
    await gateway.refundPayment("APP_USR-token", {
      amountCents: 4_000,
      idempotencyKey: "cmd-1",
      providerPaymentId: "5550001"
    });
    expect(calls[0]!.url).toBe(
      "https://api.mercadopago.com/v1/payments/5550001/refunds"
    );
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ amount: 40 });
    expect(
      (calls[0]!.init.headers as Record<string, string>)["x-idempotency-key"]
    ).toBe("cmd-1");
  });

  it("reports an unreachable provider without detail", async () => {
    const gateway = new HttpMercadoPagoGateway({
      clientId: "1",
      clientSecret: "2",
      fetch: (() =>
        Promise.reject(new Error("ECONNREFUSED secret-host"))) as never,
      redirectUri: "https://api.example.test/cb"
    });
    const failure = await gateway
      .refreshTokens("x")
      .catch((error: Error) => error);
    expect(failure).toBeInstanceOf(MercadoPagoGatewayError);
    expect((failure as Error).message).not.toContain("secret-host");
  });
});
