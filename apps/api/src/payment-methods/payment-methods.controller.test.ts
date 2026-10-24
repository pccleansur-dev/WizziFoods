import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
  UnprocessableEntityException
} from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants.js";
import { describe, expect, it, vi } from "vitest";

import { AdminAuthGuard } from "../auth/admin-auth.guard.js";
import { TenantAdminScopeGuard } from "../tenants/tenant-admin-scope.guard.js";
import { TenantHostGuard } from "../tenants/tenant-host.guard.js";
import { PaymentMethodsAdminController } from "./payment-methods.controller.js";
import { PaymentMethodsService } from "./payment-methods.service.js";
import { PaymentSecretSealer } from "./payment-secret-sealer.js";

const secret = "APP_USR-0123456789-super-secret-token";
const context = {
  identity: { userId: "f3000000-0000-4000-8000-000000000003" },
  scope: {
    locationId: "f4000000-0000-4000-8000-000000000004",
    tenantId: "f5000000-0000-4000-8000-000000000005"
  }
};
const request = { tenantAdminContext: context } as never;

function controllerWith(service: Record<string, unknown>) {
  return new PaymentMethodsAdminController(service as never);
}

async function failure(promise: Promise<unknown>) {
  return promise.then(
    () => null,
    (error: unknown) => error
  );
}

describe("PaymentMethodsAdminController", () => {
  it("requires authentication, the tenant host and administrator scope", () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, PaymentMethodsAdminController)
    ).toEqual([AdminAuthGuard, TenantHostGuard, TenantAdminScopeGuard]);
  });

  it("rejects unknown methods and injected tenant fields", async () => {
    const update = vi.fn();
    expect(
      await failure(
        controllerWith({ update }).update(request, "bitcoin", { enabled: true })
      )
    ).toBeInstanceOf(BadRequestException);
    expect(
      await failure(
        controllerWith({ update }).update(request, "cash", {
          enabled: true,
          tenantId: "x"
        })
      )
    ).toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });

  it.each([
    ["PT004", ConflictException, "PAYMENT_LAST_METHOD"],
    ["PT003", UnprocessableEntityException, "PAYMENT_PROVIDER_NOT_CONFIGURED"]
  ])("maps database error %s to %s", async (code, type, apiCode) => {
    const error = (await failure(
      controllerWith({
        update: () => Promise.reject(Object.assign(new Error("detail"), { code }))
      }).update(request, "cash", { enabled: false })
    )) as ConflictException;
    expect(error).toBeInstanceOf(type);
    expect(error.getResponse()).toEqual({
      error: { code: apiCode, message: expect.any(String) }
    });
  });

  it("never echoes a credential, even when the request is invalid", async () => {
    const error = (await failure(
      controllerWith({}).storeCredential(request, "mercado_pago", {
        extra: true,
        secret
      })
    )) as BadRequestException;
    expect(error).toBeInstanceOf(BadRequestException);
    expect(JSON.stringify(error.getResponse())).not.toContain(secret);
  });

  it("refuses credentials for methods without a provider", async () => {
    const storeCredential = vi.fn();
    const error = await failure(
      controllerWith({ storeCredential }).storeCredential(request, "cash", {
        secret
      })
    );
    expect(error).toBeInstanceOf(BadRequestException);
    expect(storeCredential).not.toHaveBeenCalled();
  });
});

describe("PaymentMethodsService", () => {
  it("hands the repository ciphertext only", async () => {
    const storeSecret = vi.fn().mockResolvedValue([]);
    const service = new PaymentMethodsService(
      { storeSecret } as never,
      new PaymentSecretSealer(Buffer.alloc(32, 3))
    );
    const result = await service.storeCredential(
      context as never,
      "mercado_pago",
      secret
    );
    expect(result).toEqual([]);
    const input = storeSecret.mock.calls[0]![0] as {
      scope: unknown;
      sealed: { ciphertext: Buffer };
    };
    expect(input.scope).toBe(context.scope);
    expect(JSON.stringify(input)).not.toContain(secret);
    expect(input.sealed.ciphertext.includes(Buffer.from(secret))).toBe(false);
  });

  it("fails closed when no encryption key is configured", () => {
    const storeSecret = vi.fn();
    const service = new PaymentMethodsService({ storeSecret } as never, null);
    expect(() =>
      service.storeCredential(context as never, "mercado_pago", secret)
    ).toThrow(ServiceUnavailableException);
    expect(storeSecret).not.toHaveBeenCalled();
  });
});
