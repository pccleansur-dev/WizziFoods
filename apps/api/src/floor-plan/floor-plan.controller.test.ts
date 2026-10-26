import {
  BadRequestException,
  ConflictException,
  UnprocessableEntityException
} from "@nestjs/common";
import { SELF_DECLARED_DEPS_METADATA } from "@nestjs/common/constants.js";
import { describe, expect, it, vi } from "vitest";

import { FloorPlanAdminController } from "./floor-plan.controller.js";
import { FloorPlanService } from "./floor-plan.service.js";

const commandId = "f5000000-0000-4000-8000-000000000005";
const sectorId = "f1000000-0000-4000-8000-000000000001";
const plan = {
  floors: [],
  groups: [],
  sectors: [{ id: sectorId, name: "Salón", position: 0 }],
  tables: []
};
const request = { tenantAdminContext: { scope: {} } } as never;

function controllerWith(service: Record<string, unknown>) {
  return new FloorPlanAdminController(service as never);
}

async function failure(promise: Promise<unknown>) {
  return promise.then(
    () => null,
    (error: unknown) => error
  );
}

describe("FloorPlanAdminController", () => {
  it("declares the service dependency", () => {
    expect(
      Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, FloorPlanAdminController)
    ).toEqual([{ index: 0, param: FloorPlanService }]);
  });

  it("returns the plan resolved from the authenticated context", async () => {
    const getPlan = vi.fn().mockResolvedValue({ plan, version: 2 });
    const result = await controllerWith({ getPlan }).get(request);
    expect(result).toEqual({ data: { plan, version: 2 } });
    expect(getPlan).toHaveBeenCalledWith(
      (request as { tenantAdminContext: unknown }).tenantAdminContext
    );
  });

  it("rejects injected tenant fields with a stable bad request", async () => {
    const savePlan = vi.fn();
    const error = await failure(
      controllerWith({ savePlan }).save(request, {
        commandId,
        expectedVersion: 0,
        plan,
        tenantId: "from-client"
      })
    );
    expect(error).toBeInstanceOf(BadRequestException);
    expect(savePlan).not.toHaveBeenCalled();
  });

  it("explains every geometry issue so the editor can point at it", async () => {
    const error = (await failure(
      controllerWith({}).save(request, {
        commandId,
        expectedVersion: 0,
        plan: {
          ...plan,
          tables: [{ id: "x" }]
        }
      })
    )) as BadRequestException;
    expect(error.getResponse()).toMatchObject({
      error: {
        code: "INVALID_FLOOR_PLAN",
        issues: [expect.objectContaining({ path: expect.any(String) })]
      }
    });
  });

  it("saves a valid command and reports whether it was replayed", async () => {
    const savePlan = vi
      .fn()
      .mockResolvedValue({ applied: false, plan, version: 3 });
    const result = await controllerWith({ savePlan }).save(request, {
      commandId,
      expectedVersion: 3,
      plan
    });
    expect(result).toEqual({ data: { applied: false, plan, version: 3 } });
  });

  it.each([
    ["40001", ConflictException, "FLOOR_PLAN_VERSION_CONFLICT"],
    ["PT280", ConflictException, "FLOOR_PLAN_GROUP_IN_USE"],
    ["23P01", UnprocessableEntityException, "FLOOR_PLAN_DUPLICATE_LABEL"],
    ["23514", UnprocessableEntityException, "FLOOR_PLAN_INVALID_GEOMETRY"]
  ])(
    "maps database error %s to %s without database details",
    async (code, type, apiCode) => {
      const error = (await failure(
        controllerWith({
          savePlan: () =>
            Promise.reject(Object.assign(new Error("secret detail"), { code }))
        }).save(request, { commandId, expectedVersion: 0, plan })
      )) as BadRequestException;
      expect(error).toBeInstanceOf(type);
      expect(JSON.stringify(error.getResponse())).toContain(apiCode);
      expect(JSON.stringify(error.getResponse())).not.toContain(
        "secret detail"
      );
    }
  );

  it("distinguishes a reused command id from other uniqueness failures", async () => {
    const reused = (await failure(
      controllerWith({
        savePlan: () =>
          Promise.reject(
            Object.assign(
              new Error("command id already used with another payload"),
              { code: "23505" }
            )
          )
      }).save(request, { commandId, expectedVersion: 0, plan })
    )) as ConflictException;
    expect(JSON.stringify(reused.getResponse())).toContain(
      "FLOOR_PLAN_COMMAND_REUSED"
    );
    const retired = (await failure(
      controllerWith({
        savePlan: () =>
          Promise.reject(
            Object.assign(new Error("a retired table cannot be restored"), {
              code: "23505"
            })
          )
      }).save(request, { commandId, expectedVersion: 0, plan })
    )) as UnprocessableEntityException;
    expect(JSON.stringify(retired.getResponse())).toContain(
      "FLOOR_PLAN_INVALID_STATE"
    );
  });

  it("lists QR codes only through the service", async () => {
    const listQrCodes = vi.fn().mockResolvedValue([{ label: "1" }]);
    await expect(
      controllerWith({ listQrCodes }).listQr(request)
    ).resolves.toEqual({
      data: [{ label: "1" }]
    });
  });

  it("verifies tokens from the body, never from the URL", async () => {
    const verifyQr = vi.fn().mockResolvedValue({ valid: false });
    const controller = controllerWith({ verifyQr });
    await expect(
      controller.verifyQr(request, { token: "ab".repeat(32) })
    ).resolves.toEqual({ data: { valid: false } });
    const error = await failure(
      controller.verifyQr(request, { token: "short", tenantId: "x" })
    );
    expect(error).toBeInstanceOf(BadRequestException);
  });

  it("rotates a QR for a valid table id only", async () => {
    const rotateQr = vi.fn().mockResolvedValue(undefined);
    const controller = controllerWith({ rotateQr });
    await controller.rotateQr(request, "a2000000-0000-4000-8000-000000000002");
    expect(rotateQr).toHaveBeenCalledOnce();
    expect(await failure(controller.rotateQr(request, "nope"))).toBeInstanceOf(
      BadRequestException
    );
  });
});
