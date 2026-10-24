import {
  BadRequestException,
  ConflictException,
  UnprocessableEntityException
} from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants.js";
import { describe, expect, it, vi } from "vitest";

import { AdminAuthGuard } from "../auth/admin-auth.guard.js";
import { TenantAdminScopeGuard } from "../tenants/tenant-admin-scope.guard.js";
import { TenantHostGuard } from "../tenants/tenant-host.guard.js";
import { ReadinessAdminController } from "./readiness.controller.js";
import { ReadinessService } from "./readiness.service.js";

const context = {
  identity: { userId: "f3000000-0000-4000-8000-000000000003" },
  scope: {
    locationId: "f4000000-0000-4000-8000-000000000004",
    tenantId: "f5000000-0000-4000-8000-000000000005"
  }
};
const request = { tenantAdminContext: context } as never;

function controllerWith(service: Record<string, unknown>) {
  return new ReadinessAdminController(service as never);
}

async function failure(promise: Promise<unknown>) {
  return promise.then(
    () => null,
    (error: unknown) => error
  );
}

function databaseError(code: string) {
  return Object.assign(new Error("secret database detail"), { code });
}

describe("ReadinessAdminController", () => {
  it("requires authentication, the tenant host and administrator scope on every route", () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, ReadinessAdminController)
    ).toEqual([AdminAuthGuard, TenantHostGuard, TenantAdminScopeGuard]);
  });

  it("reads readiness for the scope of the session, never one from the client", async () => {
    const get = vi.fn().mockResolvedValue({ ready: false });
    const result = await controllerWith({ get }).get(request);
    expect(result).toEqual({ data: { ready: false } });
    expect(get).toHaveBeenCalledWith(context);
  });

  it("publishes with an empty body only", async () => {
    const publish = vi.fn().mockResolvedValue({ ready: true });
    const controller = controllerWith({ publish });
    expect(
      await failure(controller.publish(request, { tenantId: "x" }))
    ).toBeInstanceOf(BadRequestException);
    expect(
      await failure(controller.publish(request, { ready: true }))
    ).toBeInstanceOf(BadRequestException);
    expect(publish).not.toHaveBeenCalled();
    await controller.publish(request, {});
    expect(publish).toHaveBeenCalledWith(context);
  });

  it("answers 409 with the missing requirements when the database refuses to publish", async () => {
    const readiness = { items: [{ code: "FLOOR_NO_TABLES" }], ready: false };
    const error = (await failure(
      controllerWith({
        get: () => Promise.resolve(readiness),
        publish: () => Promise.reject(databaseError("PT100"))
      }).publish(request, {})
    )) as ConflictException;
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toEqual({
      error: {
        code: "BUSINESS_NOT_READY",
        message: expect.any(String),
        readiness
      }
    });
    expect(JSON.stringify(error.getResponse())).not.toContain("secret");
  });

  it("maps already published and missing simulation prerequisites", async () => {
    const already = (await failure(
      controllerWith({
        publish: () => Promise.reject(databaseError("PT101"))
      }).publish(request, {})
    )) as ConflictException;
    expect(already.getResponse()).toEqual({
      error: { code: "BUSINESS_ALREADY_PUBLISHED", message: expect.any(String) }
    });

    const sandbox = (await failure(
      controllerWith({
        runSandbox: () => Promise.reject(databaseError("PT102"))
      }).runSandbox(request, {})
    )) as UnprocessableEntityException;
    expect(sandbox).toBeInstanceOf(UnprocessableEntityException);
    expect(sandbox.getResponse()).toEqual({
      error: {
        code: "SANDBOX_PREREQUISITES_MISSING",
        message: expect.any(String)
      }
    });
  });

  it("runs and cleans the sandbox only for the scope of the session", async () => {
    const runSandbox = vi.fn().mockResolvedValue({ namespace: "sandbox" });
    const cleanupSandbox = vi.fn().mockResolvedValue(2);
    const controller = controllerWith({ cleanupSandbox, runSandbox });
    expect(
      await failure(controller.runSandbox(request, { tenantId: "x" }))
    ).toBeInstanceOf(BadRequestException);
    expect(runSandbox).not.toHaveBeenCalled();
    await controller.runSandbox(request, {});
    expect(runSandbox).toHaveBeenCalledWith(context);
    expect(await controller.cleanupSandbox(request)).toEqual({
      data: { removed: 2 }
    });
    expect(cleanupSandbox).toHaveBeenCalledWith(context);
  });
});

describe("ReadinessService", () => {
  it("passes the session scope and the administrator id to the repository", async () => {
    const repository = {
      cleanupSandbox: vi.fn().mockResolvedValue(0),
      get: vi.fn().mockResolvedValue({}),
      publish: vi.fn().mockResolvedValue({}),
      runSandbox: vi.fn().mockResolvedValue({})
    };
    const service = new ReadinessService(repository as never);
    await service.get(context as never);
    await service.publish(context as never);
    await service.runSandbox(context as never);
    await service.cleanupSandbox(context as never);
    for (const method of Object.values(repository)) {
      expect(method).toHaveBeenCalledWith(
        context.scope,
        context.identity.userId
      );
    }
  });
});
