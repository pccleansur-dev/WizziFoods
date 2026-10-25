import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
  UnauthorizedException
} from "@nestjs/common";
import type { MercadoPagoRepository } from "@platform/database";
import { describe, expect, it, vi } from "vitest";

import { PaymentSecretSealer } from "../payment-methods/payment-secret-sealer.js";
import { FakeMercadoPagoGateway } from "./fake-mercado-pago.gateway.js";
import { MercadoPagoGatewayError } from "./mercado-pago.gateway.js";
import { MercadoPagoService } from "./mercado-pago.service.js";
import { signatureHeader } from "./webhook-signature.js";

const scope = {
  locationId: "2e000000-0000-4000-8000-000000000001",
  tenantId: "2e000000-0000-4000-8000-000000000002"
};
const paymentId = "2e000000-0000-4000-8000-000000000003";
const intentId = "2e000000-0000-4000-8000-000000000004";
const staffId = "2e000000-0000-4000-8000-000000000005";
const token = "c".repeat(64);
const secret = "webhook-secret-123456";
const now = new Date("2026-10-25T12:00:00.000Z");
const sealer = new PaymentSecretSealer(Buffer.alloc(32, 3));

function seal(expiresAt: string) {
  return sealer.seal(
    JSON.stringify({
      accessToken: "TEST-111-aa",
      expiresAt,
      refreshToken: "TESTREFRESH-111-aa"
    }),
    scope,
    "mercado_pago"
  );
}

function repository(overrides: Partial<MercadoPagoRepository> = {}) {
  const base = {
    beginOAuth: vi.fn(async () => "2026-10-25T12:10:00.000Z"),
    beginPayment: vi.fn(),
    claimWebhookEvent: vi.fn(async () => "new" as const),
    consumeOAuthState: vi.fn(),
    disconnect: vi.fn(),
    finishConnection: vi.fn(),
    finishWebhookEvent: vi.fn(),
    paymentView: vi.fn(),
    paymentsNeedingRefund: vi.fn(async () => []),
    prepareRefund: vi.fn(),
    readCredentials: vi.fn(),
    reconcile: vi.fn(),
    replaceCredentials: vi.fn(),
    resolveAccount: vi.fn(async () => scope)
  };
  return { ...base, ...overrides } as MercadoPagoRepository & typeof base;
}

function gateway() {
  return new FakeMercadoPagoGateway(
    { onChange: () => undefined, redirectUri: "http://localhost:3001/cb" },
    () => now
  );
}

function service(
  repo: MercadoPagoRepository,
  gw: FakeMercadoPagoGateway | null = gateway(),
  withSealer = true
) {
  return new MercadoPagoService(repo, withSealer ? sealer : null, gw, {
    now: () => now,
    returnUrl: "https://app.example.test/panel/pagos",
    webhookSecret: secret
  });
}

describe("MercadoPagoService", () => {
  it("is unavailable without a gateway or without the key that seals tokens", async () => {
    await expect(
      service(repository(), null).startConnection(scope, staffId)
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(
      service(repository(), gateway(), false).startConnection(scope, staffId)
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(
      service(repository(), null).handleWebhook({
        body: {},
        queryDataId: null,
        requestId: null,
        signature: null
      })
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("stores only the hash of the authorization state", async () => {
    const repo = repository();
    const result = await service(repo).startConnection(scope, staffId);
    const call = (
      repo.beginOAuth.mock.calls as unknown as [{ stateHash: Buffer }][]
    )[0]![0] as {
      stateHash: Buffer;
      requesterId: string;
      scope: unknown;
      ttlSeconds: number;
    };
    const state = new URL(result.authorizationUrl).searchParams.get("state")!;
    expect(call.stateHash).toHaveLength(32);
    expect(call.stateHash.toString("base64url")).not.toBe(state);
    expect(call).toMatchObject({
      requesterId: staffId,
      scope,
      ttlSeconds: 600
    });
  });

  it("returns to the panel with the reason when the connection fails", async () => {
    const outcomes: [unknown, string][] = [
      [Object.assign(new Error("x"), { code: "PT251" }), "in_use"],
      [Object.assign(new Error("x"), { code: "PT250" }), "expired"],
      [new MercadoPagoGatewayError("boom", 500), "error"]
    ];
    for (const [failure, expected] of outcomes) {
      const repo = repository({
        consumeOAuthState: vi.fn(async () => ({ requesterId: staffId, scope }))
      });
      if (failure instanceof MercadoPagoGatewayError) {
        const gw = gateway();
        gw.exchangeCode = vi.fn().mockRejectedValue(failure);
        const url = await service(repo, gw).completeConnection("fake-111", "s");
        expect(new URL(url).searchParams.get("mp")).toBe(expected);
        continue;
      }
      repo.consumeOAuthState = vi.fn().mockRejectedValue(failure);
      const url = await service(repo).completeConnection("fake-111", "s");
      expect(new URL(url).searchParams.get("mp")).toBe(expected);
    }
  });

  it("seals the tokens before they reach the database", async () => {
    const repo = repository({
      consumeOAuthState: vi.fn(async () => ({ requesterId: staffId, scope }))
    });
    const url = await service(repo).completeConnection("fake-111", "state");
    expect(new URL(url).searchParams.get("mp")).toBe("connected");
    const input = repo.finishConnection.mock.calls[0]![0];
    expect(input.sealed.ciphertext.includes(Buffer.from("TEST-111"))).toBe(
      false
    );
    const opened = JSON.parse(
      sealer.open(input.sealed.ciphertext, scope, "mercado_pago")
    );
    expect(opened.accessToken).toMatch(/^TEST-111-/u);
  });

  it("asks a business that never connected to connect before paying", async () => {
    const repo = repository({ readCredentials: vi.fn(async () => null) });
    await expect(
      service(repo).startPayment(scope, { intentId, token })
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("refuses the sandbox payment when the gateway is the real one", async () => {
    const live = gateway();
    Object.defineProperty(live, "mode", { value: "live" });
    const repo = repository();
    await expect(
      service(repo, live).pay(scope, {
        intentId,
        method: { kind: "sandbox", outcome: "approved" },
        token
      })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.beginPayment).not.toHaveBeenCalled();
  });

  it("refreshes a token about to expire and stores the renewed one sealed", async () => {
    const gw = gateway();
    const soon = new Date(now.getTime() + 60_000).toISOString();
    const stored = seal(soon);
    const repo = repository({
      beginPayment: vi.fn(async () => ({
        amountCents: 1_000,
        externalReference: paymentId,
        fulfillment: "waiting" as const,
        intentId,
        paymentId,
        refundedCents: 0,
        status: "created" as const
      })),
      paymentView: vi.fn(),
      readCredentials: vi.fn(async () => ({
        ...stored,
        liveMode: false,
        mpUserId: "111",
        publicKey: "TEST-key"
      })),
      reconcile: vi.fn(async () => ({
        amountCents: 1_000,
        fulfillment: "confirmed" as const,
        intentId,
        orderId: intentId,
        outcome: "applied" as const,
        paymentId,
        refundedCents: 0,
        status: "approved" as const
      }))
    });
    const refresh = vi.spyOn(gw, "refreshTokens");
    await service(repo, gw).pay(scope, {
      intentId,
      method: { kind: "sandbox", outcome: "approved" },
      token
    });
    expect(refresh).toHaveBeenCalledWith("TESTREFRESH-111-aa");
    const renewed = repo.replaceCredentials.mock.calls[0]![1];
    expect(
      JSON.parse(sealer.open(renewed.ciphertext, scope, "mercado_pago"))
        .accessToken
    ).not.toBe("TEST-111-aa");
  });

  it("never reaches the provider for an attempt that already has one", async () => {
    const gw = gateway();
    const create = vi.spyOn(gw, "createPayment");
    const repo = repository({
      beginPayment: vi.fn(async () => ({
        amountCents: 1_000,
        externalReference: paymentId,
        fulfillment: "waiting" as const,
        intentId,
        paymentId,
        refundedCents: 0,
        status: "pending" as const
      }))
    });
    await service(repo, gw).pay(scope, {
      intentId,
      method: { kind: "sandbox", outcome: "approved" },
      token
    });
    expect(create).not.toHaveBeenCalled();
    expect(repo.paymentView).toHaveBeenCalledTimes(1);
  });

  it("reports provider failures generically", async () => {
    const gw = gateway();
    gw.createPayment = vi
      .fn()
      .mockRejectedValue(new MercadoPagoGatewayError("secret detail", 500));
    const repo = repository({
      beginPayment: vi.fn(async () => ({
        amountCents: 1_000,
        externalReference: paymentId,
        fulfillment: "waiting" as const,
        intentId,
        paymentId,
        refundedCents: 0,
        status: "created" as const
      })),
      readCredentials: vi.fn(async () => ({
        ...seal(new Date(now.getTime() + 3_600_000).toISOString()),
        liveMode: false,
        mpUserId: "111",
        publicKey: "TEST-key"
      }))
    });
    const failure = await service(repo, gw)
      .pay(scope, {
        intentId,
        method: { kind: "sandbox", outcome: "approved" },
        token
      })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(BadGatewayException);
    expect(
      JSON.stringify((failure as BadGatewayException).getResponse())
    ).not.toContain("secret detail");
  });

  it("verifies the signature before looking anything up", async () => {
    const repo = repository();
    const svc = service(repo);
    const body = {
      data: { id: "5550001" },
      id: 1,
      type: "payment",
      user_id: "111"
    };
    const ts = String(Math.floor(now.getTime() / 1000));
    await expect(
      svc.handleWebhook({
        body,
        queryDataId: "5550001",
        requestId: "r",
        signature: signatureHeader("another-secret-123456", {
          dataId: "5550001",
          requestId: "r",
          ts
        })
      })
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(repo.resolveAccount).not.toHaveBeenCalled();
    expect(repo.claimWebhookEvent).not.toHaveBeenCalled();
  });

  it("ignores other topics and leaves a failed event open for the provider to retry", async () => {
    const ts = String(Math.floor(now.getTime() / 1000));
    const send = (body: unknown, svc: MercadoPagoService) =>
      svc.handleWebhook({
        body,
        queryDataId: "5550001",
        requestId: "r",
        signature: signatureHeader(secret, {
          dataId: "5550001",
          requestId: "r",
          ts
        })
      });
    const base = { data: { id: "5550001" }, id: 7, user_id: "111" };
    const repo = repository();
    await expect(
      send({ ...base, type: "merchant_order" }, service(repo))
    ).resolves.toEqual({ outcome: "ignored" });
    expect(repo.claimWebhookEvent).not.toHaveBeenCalled();

    const failing = repository({
      readCredentials: vi.fn().mockRejectedValue(new Error("database down"))
    });
    await expect(
      send({ ...base, type: "payment" }, service(failing))
    ).rejects.toThrow("database down");
    expect(failing.finishWebhookEvent).not.toHaveBeenCalled();

    const duplicate = repository({
      claimWebhookEvent: vi.fn(async () => "duplicate" as const)
    });
    await expect(
      send({ ...base, type: "payment" }, service(duplicate))
    ).resolves.toEqual({ outcome: "duplicate" });
    expect(duplicate.readCredentials).not.toHaveBeenCalled();
  });
});
