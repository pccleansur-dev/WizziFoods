import { describe, expect, it, vi } from "vitest";

import { createMercadoPagoRepository } from "./mercado-pago-repository.js";

const scope = {
  locationId: "2e000000-0000-4000-8000-000000000001",
  tenantId: "2e000000-0000-4000-8000-000000000002"
};
const paymentId = "2e000000-0000-4000-8000-000000000003";
const intentId = "2e000000-0000-4000-8000-000000000004";
const staffId = "2e000000-0000-4000-8000-000000000005";
const token = "b".repeat(64);
const hash = Buffer.alloc(32, 7);

function clientReturning(rows: unknown) {
  return vi.fn(() => Promise.resolve(rows));
}

function values(client: ReturnType<typeof vi.fn>): unknown[] {
  return (client.mock.calls[0] as unknown[]).slice(1);
}

const attempt = {
  amountCents: 25_000,
  externalReference: paymentId,
  fulfillment: "waiting",
  intentId,
  paymentId,
  refundedCents: 0,
  status: "created"
};

describe("Mercado Pago repository", () => {
  it("starts a payment with the table token and the scope of the host only", async () => {
    const client = clientReturning([{ result: attempt }]);
    await expect(
      createMercadoPagoRepository(client as never).beginPayment({
        intentId,
        scope,
        token
      })
    ).resolves.toEqual(attempt);
    expect(values(client)).toEqual([
      scope.tenantId,
      scope.locationId,
      token,
      intentId
    ]);
  });

  it("refuses non canonical scopes before touching the database", async () => {
    const client = clientReturning([]);
    await expect(
      createMercadoPagoRepository(client as never).beginPayment({
        intentId,
        scope: { locationId: "x", tenantId: scope.tenantId },
        token
      })
    ).rejects.toThrow("canonical");
    expect(client).not.toHaveBeenCalled();
  });

  it("refuses a database answer that is not canonical", async () => {
    await expect(
      createMercadoPagoRepository(
        clientReturning([{ result: { ...attempt, extra: 1 } }]) as never
      ).beginPayment({ intentId, scope, token })
    ).rejects.toThrow("canonical");
    await expect(
      createMercadoPagoRepository(
        clientReturning([
          { result: { intentId, intentStatus: "gone" } }
        ]) as never
      ).paymentView({ intentId, scope, token })
    ).rejects.toThrow("canonical");
  });

  it("reconciles a snapshot field by field", async () => {
    const snapshot = {
      amountCents: 25_000,
      externalReference: paymentId,
      providerPaymentId: "5550001",
      refundedCents: 5_000,
      status: "approved",
      statusDetail: "accredited",
      updatedAt: "2026-10-25T12:00:00.000Z"
    };
    const reconciled = {
      amountCents: 25_000,
      fulfillment: "confirmed",
      intentId,
      orderId: intentId,
      outcome: "applied",
      paymentId,
      refundedCents: 5_000,
      status: "approved"
    };
    const client = clientReturning([{ result: reconciled }]);
    await expect(
      createMercadoPagoRepository(client as never).reconcile({
        paymentId,
        scope,
        snapshot
      })
    ).resolves.toEqual(reconciled);
    expect(values(client)).toEqual([
      scope.tenantId,
      scope.locationId,
      paymentId,
      paymentId,
      "5550001",
      "approved",
      "accredited",
      25_000,
      5_000,
      "2026-10-25T12:00:00.000Z"
    ]);
    await expect(
      createMercadoPagoRepository(clientReturning([]) as never).reconcile({
        paymentId,
        scope,
        snapshot: { ...snapshot, status: "paid" }
      })
    ).rejects.toThrow("canonical");
  });

  it("reads the sealed credential back as bytes and reports none when unconnected", async () => {
    const stored = {
      ciphertext: Buffer.alloc(40, 9).toString("base64"),
      keyVersion: 1,
      liveMode: false,
      mpUserId: "1234567",
      publicKey: "APP_USR-key"
    };
    const read = await createMercadoPagoRepository(
      clientReturning([{ result: stored }]) as never
    ).readCredentials(scope);
    expect(read?.ciphertext.equals(Buffer.alloc(40, 9))).toBe(true);
    expect(read).toMatchObject({ mpUserId: "1234567", liveMode: false });
    await expect(
      createMercadoPagoRepository(
        clientReturning([{ result: null }]) as never
      ).readCredentials(scope)
    ).resolves.toBeNull();
    await expect(
      createMercadoPagoRepository(
        clientReturning([{ result: { ...stored, liveMode: "no" } }]) as never
      ).readCredentials(scope)
    ).rejects.toThrow("canonical");
  });

  it("validates what it stores", async () => {
    const repository = createMercadoPagoRepository(
      clientReturning([]) as never
    );
    await expect(
      repository.finishConnection({
        liveMode: false,
        mpUserId: "1",
        publicKey: "APP_USR-key",
        requesterId: staffId,
        scope,
        sealed: { ciphertext: Buffer.alloc(3), keyVersion: 1 }
      })
    ).rejects.toThrow("canonical");
    await expect(
      repository.beginOAuth({
        requesterId: staffId,
        scope,
        stateHash: Buffer.alloc(5),
        ttlSeconds: 600
      })
    ).rejects.toThrow("32 bytes");
    await expect(
      repository.replaceCredentials(scope, {
        ciphertext: Buffer.alloc(40),
        keyVersion: 0
      })
    ).rejects.toThrow("canonical");
  });

  it("begins the authorization and consumes its state", async () => {
    const begin = createMercadoPagoRepository(
      clientReturning([{ expiresAt: "2026-10-25 12:10:00.123456+00" }]) as never
    );
    await expect(
      begin.beginOAuth({
        requesterId: staffId,
        scope,
        stateHash: hash,
        ttlSeconds: 600
      })
    ).resolves.toBe("2026-10-25T12:10:00.123Z");
    const consumed = await createMercadoPagoRepository(
      clientReturning([{ result: { ...scope, requesterId: staffId } }]) as never
    ).consumeOAuthState(hash);
    expect(consumed).toEqual({ requesterId: staffId, scope });
  });

  it("resolves a seller to a business or to nothing", async () => {
    await expect(
      createMercadoPagoRepository(
        clientReturning([{ result: scope }]) as never
      ).resolveAccount("1234567")
    ).resolves.toEqual(scope);
    await expect(
      createMercadoPagoRepository(
        clientReturning([{ result: null }]) as never
      ).resolveAccount("999")
    ).resolves.toBeNull();
  });

  it("claims and finishes webhook events and lists payments to return", async () => {
    for (const claim of ["new", "retry", "duplicate"] as const) {
      await expect(
        createMercadoPagoRepository(
          clientReturning([{ claim }]) as never
        ).claimWebhookEvent({
          dataId: "5550001",
          eventKey: "payment:1",
          scope: null,
          topic: "payment"
        })
      ).resolves.toBe(claim);
    }
    await expect(
      createMercadoPagoRepository(
        clientReturning([{ claim: "maybe" }]) as never
      ).claimWebhookEvent({
        dataId: "1",
        eventKey: "payment:1",
        scope,
        topic: "payment"
      })
    ).rejects.toThrow("canonical");
    const finish = clientReturning([]);
    await createMercadoPagoRepository(finish as never).finishWebhookEvent(
      "payment:1",
      "applied"
    );
    expect(values(finish)).toEqual(["payment:1", "applied"]);
    await expect(
      createMercadoPagoRepository(
        clientReturning([
          {
            result: [
              {
                ...scope,
                paymentId,
                providerPaymentId: "5550001",
                remainingCents: 8_000
              }
            ]
          }
        ]) as never
      ).paymentsNeedingRefund(10)
    ).resolves.toEqual([
      {
        paymentId,
        providerPaymentId: "5550001",
        remainingCents: 8_000,
        scope
      }
    ]);
  });

  it("prepares a refund with the reason for the audit trail", async () => {
    const client = clientReturning([
      {
        result: { amountCents: 4_000, paymentId, providerPaymentId: "5550001" }
      }
    ]);
    await expect(
      createMercadoPagoRepository(client as never).prepareRefund({
        amountCents: 4_000,
        paymentId,
        reason: "Se terminó",
        scope,
        sessionId: intentId,
        staffId
      })
    ).resolves.toEqual({
      amountCents: 4_000,
      paymentId,
      providerPaymentId: "5550001"
    });
    expect(values(client)).toEqual([
      scope.tenantId,
      scope.locationId,
      staffId,
      intentId,
      paymentId,
      4_000,
      "Se terminó"
    ]);
  });
});
