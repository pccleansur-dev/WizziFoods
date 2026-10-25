import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  DinerAuthUnavailableError,
  DinerIdentityService,
  DinerLoginInvalidError,
  DinerSessionInvalidError
} from "./diner-identity.service.js";
import type { GoogleOidcGateway } from "./google-oidc.gateway.js";

const tenantId = "2f000000-0000-4000-8000-000000000001";
const accountId = "2f000000-0000-4000-8000-000000000003";
const host = "demo.plataforma.test";
const binding = "B".repeat(43);
const bindingHash = createHash("sha256").update(binding).digest("hex");
const config = {
  stateSecret: "s".repeat(32),
  subPepper: "p".repeat(32)
};

function sha(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function gateway(
  identity = { email: "ana@example.com", emailVerified: true, sub: "sub-1" }
): GoogleOidcGateway {
  return {
    authorizeUrl: (state) => `https://google.test/auth?state=${state}`,
    exchange: vi.fn().mockResolvedValue(identity)
  };
}

function repositoryStub() {
  return {
    anonymize: vi.fn().mockResolvedValue(new Date()),
    createLoginExchange: vi.fn().mockResolvedValue(undefined),
    export: vi.fn(),
    getProfile: vi.fn(),
    linkToSession: vi.fn(),
    recordConsent: vi.fn(),
    redeemLogin: vi.fn().mockResolvedValue(accountId),
    resolveSession: vi.fn().mockResolvedValue(accountId),
    revokeSession: vi.fn().mockResolvedValue(undefined),
    saveProfile: vi.fn(),
    upsertAccount: vi.fn().mockResolvedValue(accountId)
  };
}

function service(
  repository = repositoryStub(),
  google: GoogleOidcGateway | null = gateway(),
  scheme: "http" | "https" = "https"
) {
  return {
    repository,
    service: new DinerIdentityService(repository as never, google, {
      ...config,
      scheme
    })
  };
}

function stateOf(url: string): string {
  return new URL(url).searchParams.get("state") ?? "";
}

describe("DinerIdentityService login", () => {
  it("is unavailable while Google is not configured", async () => {
    const { service: off } = service(repositoryStub(), null);
    await expect(
      off.start({ bindingHash, host, returnPath: "/m/x", tenantId })
    ).rejects.toBeInstanceOf(DinerAuthUnavailableError);
  });

  it("round-trips through Google and hands the code back to the same host", async () => {
    const { repository, service: diner } = service();
    const authorize = await diner.start({
      bindingHash,
      host,
      returnPath: "/m/abc",
      tenantId
    });
    const redirect = await diner.complete({
      code: "google-code",
      state: stateOf(authorize)
    });
    const target = new URL(redirect);
    expect(target.origin).toBe(`https://${host}`);
    expect(target.pathname).toBe("/api/diner/complete");
    expect(target.searchParams.get("next")).toBe("/m/abc");
    const code = target.searchParams.get("code") ?? "";
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    const exchange = repository.createLoginExchange.mock.calls[0]?.[0];
    expect(exchange.tenantId).toBe(tenantId);
    expect(exchange.accountId).toBe(accountId);
    // The stored code is bound to the cookie secret of the browser that started it.
    expect(exchange.codeHash).toEqual(sha(`${code}:${bindingHash}`));
  });

  it("stores only a keyed hash of the Google subject", async () => {
    const { repository, service: diner } = service();
    const authorize = await diner.start({
      bindingHash,
      host,
      returnPath: "/",
      tenantId
    });
    await diner.complete({ code: "c", state: stateOf(authorize) });
    const stored = repository.upsertAccount.mock.calls[0]?.[0];
    expect(stored.subHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(stored.subHash).not.toContain("sub-1");
    expect(stored.subHash).not.toBe(
      createHash("sha256").update("sub-1").digest("hex")
    );
    expect(stored.email).toBe("ana@example.com");
  });

  it("refuses a forged or altered state and an expired one", async () => {
    const { service: diner } = service();
    const authorize = await diner.start({
      bindingHash,
      host,
      returnPath: "/",
      tenantId
    });
    const state = stateOf(authorize);
    const [payload, signature] = state.split(".");
    const forged = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(payload ?? "", "base64url").toString()),
        t: "2f000000-0000-4000-8000-000000000009"
      })
    ).toString("base64url");
    await expect(
      diner.complete({ code: "c", state: `${forged}.${signature}` })
    ).rejects.toBeInstanceOf(DinerLoginInvalidError);
    await expect(
      diner.complete({ code: "c", state: "garbage" })
    ).rejects.toBeInstanceOf(DinerLoginInvalidError);

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 11 * 60_000);
    await expect(diner.complete({ code: "c", state })).rejects.toBeInstanceOf(
      DinerLoginInvalidError
    );
    vi.useRealTimers();
  });

  it("refuses a Google identity whose email is not verified", async () => {
    const { repository, service: diner } = service(
      repositoryStub(),
      gateway({ email: "x@example.com", emailVerified: false, sub: "s" })
    );
    const authorize = await diner.start({
      bindingHash,
      host,
      returnPath: "/",
      tenantId
    });
    await expect(
      diner.complete({ code: "c", state: stateOf(authorize) })
    ).rejects.toBeInstanceOf(DinerLoginInvalidError);
    expect(repository.upsertAccount).not.toHaveBeenCalled();
  });

  it("sends a diner who refused Google back to the menu without a session", async () => {
    const { repository, service: diner } = service();
    const authorize = await diner.start({
      bindingHash,
      host,
      returnPath: "/m/abc",
      tenantId
    });
    await expect(diner.cancel(stateOf(authorize))).resolves.toBe(
      `https://${host}/m/abc`
    );
    expect(repository.createLoginExchange).not.toHaveBeenCalled();
    await expect(diner.cancel("garbage")).rejects.toBeInstanceOf(
      DinerLoginInvalidError
    );
  });

  it("never redirects to a host that is not a plain host name", async () => {
    const { service: diner } = service();
    for (const bad of [
      "evil.test/@x",
      "a.test\r\nx: y",
      "user@evil.test",
      "",
      "a b.test"
    ]) {
      await expect(
        diner.start({ bindingHash, host: bad, returnPath: "/", tenantId })
      ).rejects.toBeInstanceOf(DinerLoginInvalidError);
    }
  });

  it("uses http for local hosts", async () => {
    const { service: diner } = service(repositoryStub(), gateway(), "http");
    const authorize = await diner.start({
      bindingHash,
      host: "demo.localhost:3100",
      returnPath: "/",
      tenantId
    });
    const redirect = await diner.complete({
      code: "c",
      state: stateOf(authorize)
    });
    expect(new URL(redirect).origin).toBe("http://demo.localhost:3100");
  });
});

describe("DinerIdentityService sessions", () => {
  it("redeems with the cookie secret and returns an opaque token whose hash is stored", async () => {
    const { repository, service: diner } = service();
    const code = "C".repeat(43);
    const token = await diner.redeem({ binding, code, tenantId });
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    const call = repository.redeemLogin.mock.calls[0]?.[0];
    expect(call.codeHash).toEqual(sha(`${code}:${bindingHash}`));
    expect(call.sessionHash).toEqual(sha(token));
    expect(call.tenantId).toBe(tenantId);
  });

  it("rejects a code that does not redeem", async () => {
    const repository = repositoryStub();
    repository.redeemLogin.mockResolvedValue(null);
    await expect(
      service(repository).service.redeem({
        binding,
        code: "C".repeat(43),
        tenantId
      })
    ).rejects.toBeInstanceOf(DinerLoginInvalidError);
  });

  it("authenticates by hashing the bearer token for the host's tenant", async () => {
    const { repository, service: diner } = service();
    const token = "T".repeat(43);
    await expect(diner.authenticate(tenantId, token)).resolves.toBe(accountId);
    expect(repository.resolveSession).toHaveBeenCalledWith({
      tenantId,
      tokenHash: sha(token)
    });
  });

  it("rejects a missing, malformed or unknown session", async () => {
    const repository = repositoryStub();
    repository.resolveSession.mockResolvedValue(null);
    const { service: diner } = service(repository);
    await expect(
      diner.authenticate(tenantId, undefined)
    ).rejects.toBeInstanceOf(DinerSessionInvalidError);
    await expect(diner.authenticate(tenantId, "short")).rejects.toBeInstanceOf(
      DinerSessionInvalidError
    );
    await expect(
      diner.authenticate(tenantId, "T".repeat(43))
    ).rejects.toBeInstanceOf(DinerSessionInvalidError);
  });
});
