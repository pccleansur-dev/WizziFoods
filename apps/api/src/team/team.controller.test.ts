import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException
} from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants.js";
import { describe, expect, it, vi } from "vitest";

import { AdminAuthGuard } from "../auth/admin-auth.guard.js";
import { TenantAdminScopeGuard } from "../tenants/tenant-admin-scope.guard.js";
import { TenantHostGuard } from "../tenants/tenant-host.guard.js";
import { TeamAdminController } from "./team.controller.js";
import { TeamService } from "./team.service.js";

const memberId = "f2000000-0000-4000-8000-000000000002";
const sectorId = "f1000000-0000-4000-8000-000000000001";
const context = {
  identity: { userId: "f3000000-0000-4000-8000-000000000003" },
  scope: {
    locationId: "f4000000-0000-4000-8000-000000000004",
    tenantId: "f5000000-0000-4000-8000-000000000005"
  }
};
const request = { tenantAdminContext: context } as never;
const valid = {
  displayName: "Ana",
  pin: "123456",
  role: "waiter",
  sectorIds: [sectorId],
  username: "ana"
};

function controllerWith(service: Record<string, unknown>) {
  return new TeamAdminController(service as never);
}

async function failure(promise: Promise<unknown>) {
  return promise.then(
    () => null,
    (error: unknown) => error
  );
}

describe("TeamAdminController", () => {
  it("requires authentication, the tenant host and administrator scope", () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, TeamAdminController)).toEqual([
      AdminAuthGuard,
      TenantHostGuard,
      TenantAdminScopeGuard
    ]);
  });

  it("creates a member from the authenticated scope only", async () => {
    const create = vi.fn().mockResolvedValue({ id: memberId });
    const result = await controllerWith({ create }).create(request, valid);
    expect(result).toEqual({ data: { id: memberId } });
    expect(create).toHaveBeenCalledWith(context, valid);
  });

  it.each([
    ["tenantId", { ...valid, tenantId: "x" }],
    ["locationId", { ...valid, locationId: "x" }],
    ["short pin", { ...valid, pin: "1" }]
  ])("rejects %s before reaching the service", async (_name, body) => {
    const create = vi.fn();
    const error = await failure(
      controllerWith({ create }).create(request, body)
    );
    expect(error).toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
    expect(
      JSON.stringify((error as BadRequestException).getResponse())
    ).not.toContain("123456");
  });

  it("rejects malformed member ids", async () => {
    const error = await failure(
      controllerWith({}).update(request, "not-a-uuid", {
        displayName: "Ana",
        role: "waiter",
        sectorIds: []
      })
    );
    expect(error).toBeInstanceOf(BadRequestException);
  });

  it.each([
    ["23505", ConflictException, "TEAM_USERNAME_TAKEN"],
    ["PT001", ConflictException, "TEAM_LAST_MANAGER"],
    ["P0002", NotFoundException, "TEAM_MEMBER_NOT_FOUND"],
    ["22023", UnprocessableEntityException, "TEAM_INVALID_STATE"]
  ])("maps database error %s to %s", async (code, type, apiCode) => {
    const error = (await failure(
      controllerWith({
        setActive: () =>
          Promise.reject(
            Object.assign(new Error("detail: key (username)=(ana)"), { code })
          )
      }).setActive(request, memberId, { active: false })
    )) as ConflictException;
    expect(error).toBeInstanceOf(type);
    expect(error.getResponse()).toEqual({
      error: { code: apiCode, message: expect.any(String) }
    });
    expect(JSON.stringify(error.getResponse())).not.toContain("ana");
  });

  it("resets a PIN without returning it", async () => {
    const resetPin = vi.fn().mockResolvedValue(undefined);
    const result = await controllerWith({ resetPin }).resetPin(
      request,
      memberId,
      { pin: "654321" }
    );
    expect(result).toBeUndefined();
    expect(resetPin).toHaveBeenCalledWith(context, memberId, "654321");
  });
});

describe("TeamService", () => {
  it("hashes the PIN before the repository sees it", async () => {
    const create = vi.fn().mockResolvedValue({ id: memberId });
    const service = new TeamService(
      { create } as never,
      "test-pepper-with-at-least-32-characters"
    );
    const { pin, ...member } = valid;
    await service.create(context as never, valid as never);
    const input = create.mock.calls[0]![0] as {
      member: unknown;
      pinHash: string;
      scope: unknown;
    };
    expect(input.pinHash).toMatch(/^scrypt-v1\$/u);
    expect(JSON.stringify(input)).not.toContain(pin);
    expect(input.member).toEqual(member);
    expect(input.scope).toBe(context.scope);
  });
});
