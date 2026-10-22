import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { SELF_DECLARED_DEPS_METADATA } from "@nestjs/common/constants.js";
import { describe, expect, it } from "vitest";

import {
  StaffAuthController,
  StaffSessionController
} from "./staff-auth.controller.js";
import { StaffAuthService } from "./staff-auth.service.js";

describe("StaffAuthController", () => {
  it("declares its service dependency explicitly", () => {
    expect(
      Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, StaffAuthController)
    ).toEqual([{ index: 0, param: StaffAuthService }]);
  });

  it("normalizes input at the HTTP boundary", async () => {
    const service = {
      signIn: async (tenantSlug: string, input: unknown) => ({
        input,
        tenantSlug
      })
    } as unknown as StaffAuthService;
    const controller = new StaffAuthController(service);

    await expect(
      controller.create("restaurante-demo", {
        pin: "194827",
        username: "  Ana.Moza "
      })
    ).resolves.toEqual({
      data: {
        input: { pin: "194827", username: "ana.moza" },
        tenantSlug: "restaurante-demo"
      }
    });
  });

  it("returns the shared validation error shape", async () => {
    const service = {
      signIn: async () => undefined
    } as unknown as StaffAuthService;
    const controller = new StaffAuthController(service);

    await expect(
      controller.create("INVALID TENANT", { pin: "123", username: "a" })
    ).rejects.toEqual(
      new BadRequestException({
        error: {
          code: "INVALID_STAFF_LOGIN",
          message: "Revisá el negocio, usuario y PIN ingresados."
        }
      })
    );
  });
});

describe("StaffSessionController", () => {
  const token = "a".repeat(43);

  it("declares its service dependency explicitly", () => {
    expect(
      Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, StaffSessionController)
    ).toEqual([{ index: 0, param: StaffAuthService }]);
  });

  it("reads, revalidates and revokes the bearer session", async () => {
    const calls: string[] = [];
    const service = {
      currentSession: async (accessToken: string) => {
        calls.push(`get:${accessToken}`);
        return { active: true };
      },
      revalidate: async (accessToken: string, body: unknown) => {
        calls.push(`revalidate:${accessToken}:${JSON.stringify(body)}`);
        return { revalidatedAt: "2026-10-21T18:00:00.000Z" };
      },
      signOut: async (accessToken: string) => {
        calls.push(`delete:${accessToken}`);
      }
    } as unknown as StaffAuthService;
    const controller = new StaffSessionController(service);

    await expect(controller.getCurrent(`Bearer ${token}`)).resolves.toEqual({
      data: { active: true }
    });
    await expect(
      controller.createRevalidation(`Bearer ${token}`, { pin: "194827" })
    ).resolves.toEqual({
      data: { revalidatedAt: "2026-10-21T18:00:00.000Z" }
    });
    await expect(controller.deleteCurrent(`Bearer ${token}`)).resolves.toBe(
      undefined
    );
    expect(calls).toEqual([
      `get:${token}`,
      `revalidate:${token}:{"pin":"194827"}`,
      `delete:${token}`
    ]);
  });

  it("rejects missing session credentials and malformed revalidation", async () => {
    const service = {} as StaffAuthService;
    const controller = new StaffSessionController(service);

    await expect(controller.getCurrent(undefined)).rejects.toEqual(
      new UnauthorizedException({
        error: {
          code: "STAFF_SESSION_INVALID",
          message: "La sesión del personal venció o ya no está disponible."
        }
      })
    );
    await expect(
      controller.createRevalidation(`Bearer ${token}`, { pin: "123" })
    ).rejects.toEqual(
      new BadRequestException({
        error: {
          code: "INVALID_STAFF_REVALIDATION",
          message: "Ingresá un PIN válido de seis dígitos."
        }
      })
    );
  });
});
