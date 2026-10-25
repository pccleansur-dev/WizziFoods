import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException
} from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { DinerAccountController } from "./diner-account.controller.js";
import {
  DinerAuthCallbackController,
  DinerAuthController
} from "./diner-auth.controller.js";
import {
  DinerAuthUnavailableError,
  DinerLoginInvalidError,
  DinerSessionInvalidError
} from "./diner-identity.service.js";

const tenantId = "2f000000-0000-4000-8000-000000000001";
const locationId = "2f000000-0000-4000-8000-000000000002";
const accountId = "2f000000-0000-4000-8000-000000000003";
const commandId = "2f000000-0000-4000-8000-000000000004";
const token = "T".repeat(43);
const authorization = `Bearer ${token}`;
const request = {
  headers: { host: "demo.plataforma.test" },
  tenantHostContext: {
    location: { id: locationId },
    tenant: { id: tenantId }
  }
} as never;

function serviceStub() {
  return {
    anonymize: vi.fn().mockResolvedValue(undefined),
    authenticate: vi.fn().mockResolvedValue(accountId),
    cancel: vi.fn().mockResolvedValue("https://demo.plataforma.test/m/x"),
    complete: vi.fn().mockResolvedValue("https://demo.plataforma.test/x"),
    export: vi.fn().mockResolvedValue({ account: {}, restaurants: [] }),
    getProfile: vi.fn().mockResolvedValue({ profile: null, texts: [] }),
    linkToSession: vi.fn().mockResolvedValue({ linked: true }),
    logout: vi.fn().mockResolvedValue(undefined),
    recordConsent: vi.fn().mockResolvedValue({ profile: null, texts: [] }),
    redeem: vi.fn().mockResolvedValue(token),
    saveProfile: vi.fn().mockResolvedValue({ profile: null, texts: [] }),
    start: vi.fn().mockResolvedValue("https://google.test/auth")
  };
}

function dbError(code: string) {
  return Object.assign(new Error("db"), { code });
}

describe("DinerAccountController", () => {
  it("takes the account from the session and the restaurant from the host", async () => {
    const service = serviceStub();
    const controller = new DinerAccountController(service as never);
    await controller.me(request, authorization);
    expect(service.authenticate).toHaveBeenCalledWith(tenantId, token);
    expect(service.getProfile).toHaveBeenCalledWith(tenantId, accountId);
  });

  it("rejects every route without a valid session, before touching data", async () => {
    const service = serviceStub();
    service.authenticate.mockRejectedValue(new DinerSessionInvalidError());
    const controller = new DinerAccountController(service as never);
    const body = { displayName: "Ana" };
    for (const call of [
      () => controller.me(request, undefined),
      () => controller.saveProfile(request, undefined, body),
      () => controller.export(request, undefined),
      () => controller.anonymize(request, undefined)
    ]) {
      await expect(call()).rejects.toBeInstanceOf(UnauthorizedException);
    }
    expect(service.getProfile).not.toHaveBeenCalled();
    expect(service.saveProfile).not.toHaveBeenCalled();
    expect(service.export).not.toHaveBeenCalled();
    expect(service.anonymize).not.toHaveBeenCalled();
  });

  it("refuses a body that tries to choose the tenant, account or email", async () => {
    const service = serviceStub();
    const controller = new DinerAccountController(service as never);
    for (const extra of [
      { tenantId },
      { accountId },
      { email: "x@example.com" }
    ]) {
      await expect(
        controller.saveProfile(request, authorization, {
          displayName: "Ana",
          ...extra
        })
      ).rejects.toBeInstanceOf(BadRequestException);
    }
    await expect(
      controller.consent(request, authorization, {
        action: "granted",
        commandId,
        kind: "marketing",
        source: "anonymization",
        textVersion: 1
      })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.saveProfile).not.toHaveBeenCalled();
    expect(service.recordConsent).not.toHaveBeenCalled();
  });

  it("records a consent and links the session with the host's scope", async () => {
    const service = serviceStub();
    const controller = new DinerAccountController(service as never);
    await controller.consent(request, authorization, {
      action: "granted",
      commandId,
      kind: "marketing",
      source: "menu",
      textVersion: 1
    });
    expect(service.recordConsent).toHaveBeenCalledWith(tenantId, accountId, {
      action: "granted",
      commandId,
      kind: "marketing",
      source: "menu",
      textVersion: 1
    });
    await controller.link(request, authorization, { token: "a".repeat(64) });
    expect(service.linkToSession).toHaveBeenCalledWith(
      { locationId, tenantId },
      accountId,
      "a".repeat(64)
    );
  });

  it.each([
    ["PT282", "DINER_PROFILE_REQUIRED"],
    ["PT283", "CONSENT_TEXT_OUTDATED"],
    ["PT284", "DINER_PHONE_CONFLICT"],
    ["PT285", "CONSENT_NOT_GRANTED"],
    ["PT286", "COMMAND_REUSED"]
  ])("maps %s to a conflict the screen understands", async (code, name) => {
    const service = serviceStub();
    service.recordConsent.mockRejectedValue(dbError(code));
    const controller = new DinerAccountController(service as never);
    const failure = await controller
      .consent(request, authorization, {
        action: "revoked",
        commandId,
        kind: "marketing",
        source: "profile",
        textVersion: 1
      })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ConflictException);
    expect(
      JSON.stringify((failure as ConflictException).getResponse())
    ).toContain(name);
  });

  it("treats an anonymized account as a finished session", async () => {
    const service = serviceStub();
    service.getProfile.mockRejectedValue(dbError("PT281"));
    await expect(
      new DinerAccountController(service as never).me(request, authorization)
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("anonymizes the account of the session only", async () => {
    const service = serviceStub();
    await new DinerAccountController(service as never).anonymize(
      request,
      authorization
    );
    expect(service.anonymize).toHaveBeenCalledWith(accountId);
  });
});

describe("DinerAuthController", () => {
  const binding = "a".repeat(64);

  it("starts a login for the host that asked, with a local return path", async () => {
    const service = serviceStub();
    const controller = new DinerAuthController(service as never, true);
    await expect(
      controller.start(request, { bindingHash: binding, returnPath: "/m/x" })
    ).resolves.toEqual({ data: { authorizeUrl: "https://google.test/auth" } });
    expect(service.start).toHaveBeenCalledWith({
      bindingHash: binding,
      host: "demo.plataforma.test",
      returnPath: "/m/x",
      tenantId
    });
  });

  it("refuses a return path that leaves the restaurant", async () => {
    const service = serviceStub();
    await expect(
      new DinerAuthController(service as never, true).start(request, {
        bindingHash: binding,
        returnPath: "//evil.test"
      })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.start).not.toHaveBeenCalled();
  });

  it("answers 404 when Google is not configured and 401 for a bad code", async () => {
    const service = serviceStub();
    service.start.mockRejectedValue(new DinerAuthUnavailableError());
    service.redeem.mockRejectedValue(new DinerLoginInvalidError());
    const controller = new DinerAuthController(service as never, false);
    expect(controller.availability()).toEqual({ data: { available: false } });
    await expect(
      controller.start(request, { bindingHash: binding, returnPath: "/" })
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      controller.redeem(request, {
        binding: "B".repeat(43),
        code: "C".repeat(43)
      })
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("logs out with the bearer token and ignores a missing one", async () => {
    const service = serviceStub();
    const controller = new DinerAuthController(service as never, true);
    await controller.logout(request, authorization);
    expect(service.logout).toHaveBeenCalledWith(tenantId, token);
    await controller.logout(request, undefined);
    expect(service.logout).toHaveBeenCalledTimes(1);
  });
});

describe("DinerAuthCallbackController", () => {
  function reply() {
    const sent: { headers: Record<string, string>; status?: number } = {
      headers: {}
    };
    const chain = {
      header(name: string, value: string) {
        sent.headers[name] = value;
        return chain;
      },
      send: () => sent,
      status(code: number) {
        sent.status = code;
        return chain;
      }
    };
    return { chain, sent };
  }

  it("redirects to the restaurant that started the login", async () => {
    const service = serviceStub();
    const { chain, sent } = reply();
    await new DinerAuthCallbackController(service as never).callback(
      "google-code",
      "signed.state",
      undefined,
      chain as never
    );
    expect(sent.status).toBe(302);
    expect(sent.headers.location).toBe("https://demo.plataforma.test/x");
    expect(sent.headers["cache-control"]).toBe("no-store");
  });

  it("sends a diner who refused Google back to the menu", async () => {
    const service = serviceStub();
    const { chain, sent } = reply();
    await new DinerAuthCallbackController(service as never).callback(
      undefined,
      "signed.state",
      "access_denied",
      chain as never
    );
    expect(service.complete).not.toHaveBeenCalled();
    expect(sent.headers.location).toBe("https://demo.plataforma.test/m/x");
  });
});
