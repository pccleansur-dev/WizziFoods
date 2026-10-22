import { createHash } from "node:crypto";

import type { StaffAuthRepository } from "@platform/database";
import { describe, expect, it } from "vitest";

import { hashStaffPin } from "./pin-credential.js";
import { StaffAuthService } from "./staff-auth.service.js";

const now = new Date("2026-10-21T18:00:00.000Z");
const pepper = "test-only-pepper-with-more-than-32-characters";
const identity = {
  location: { id: "20000000-0000-4000-8000-000000000002", name: "Principal" },
  staff: {
    displayName: "Ana",
    id: "30000000-0000-4000-8000-000000000003",
    role: "waiter" as const
  },
  tenant: {
    id: "10000000-0000-4000-8000-000000000001",
    name: "Restaurante Demo",
    slug: "restaurante-demo"
  }
};

function stubRepository(
  overrides: Partial<StaffAuthRepository>
): StaffAuthRepository {
  return {
    authenticate: async () => ({ result: "invalid" }),
    resolveSession: async () => null,
    revalidate: async () => ({ result: "unauthorized" }),
    revokeSession: async () => false,
    ...overrides
  };
}

describe("StaffAuthService", () => {
  it("creates an opaque eight-hour session for a valid PIN", async () => {
    const storedPinHash = await hashStaffPin("194827", pepper);
    let receivedTokenHash = "";
    const repository = stubRepository({
      authenticate: async (input) => {
        receivedTokenHash = input.tokenHash;
        expect(await input.verifyPin(storedPinHash)).toBe(true);
        return { identity, result: "authenticated" };
      }
    });
    const service = new StaffAuthService(
      repository,
      pepper,
      () => now,
      () => "placeholder-session-token-for-tests"
    );

    await expect(
      service.signIn("restaurante-demo", {
        pin: "194827",
        username: "ana.moza"
      })
    ).resolves.toEqual({
      accessToken: "placeholder-session-token-for-tests",
      expiresAt: "2026-10-22T02:00:00.000Z",
      identity: {
        ...identity,
        staff: {
          ...identity.staff,
          capabilities: [
            "calls.manage",
            "tables.serve",
            "orders.manage",
            "orders.validate",
            "payments.collect"
          ]
        }
      },
      lastRevalidatedAt: "2026-10-21T18:00:00.000Z"
    });
    expect(receivedTokenHash).toBe(
      createHash("sha256")
        .update("placeholder-session-token-for-tests")
        .digest("hex")
    );
  });

  it("uses the same public error for unknown, inactive or locked access", async () => {
    const repository = stubRepository({
      authenticate: async (input) => {
        expect(await input.verifyPin(null)).toBe(false);
        return { result: "invalid" };
      }
    });
    const service = new StaffAuthService(repository, pepper, () => now);

    await expect(
      service.signIn("restaurante-demo", {
        pin: "194827",
        username: "desconocido"
      })
    ).rejects.toMatchObject({
      response: {
        error: {
          code: "STAFF_AUTH_FAILED",
          message:
            "No pudimos verificar el usuario y PIN, o el acceso está bloqueado temporalmente."
        }
      },
      status: 401
    });
  });

  it("resolves an active session without exposing its stored token hash", async () => {
    const repository = stubRepository({
      resolveSession: async (tokenHash, receivedNow) => {
        expect(tokenHash).toBe(
          createHash("sha256").update("a".repeat(43)).digest("hex")
        );
        expect(receivedNow).toEqual(now);
        return {
          expiresAt: new Date("2026-10-22T02:00:00.000Z"),
          identity,
          lastRevalidatedAt: now
        };
      }
    });
    const service = new StaffAuthService(repository, pepper, () => now);

    await expect(service.currentSession("a".repeat(43))).resolves.toEqual({
      expiresAt: "2026-10-22T02:00:00.000Z",
      identity: {
        ...identity,
        staff: {
          ...identity.staff,
          capabilities: [
            "calls.manage",
            "tables.serve",
            "orders.manage",
            "orders.validate",
            "payments.collect"
          ]
        }
      },
      lastRevalidatedAt: "2026-10-21T18:00:00.000Z"
    });
  });

  it("revokes the hashed session token", async () => {
    let receivedTokenHash = "";
    const repository = stubRepository({
      revokeSession: async (tokenHash) => {
        receivedTokenHash = tokenHash;
        return true;
      }
    });
    const service = new StaffAuthService(repository, pepper, () => now);

    await service.signOut("b".repeat(43));
    expect(receivedTokenHash).toBe(
      createHash("sha256").update("b".repeat(43)).digest("hex")
    );
  });

  it("revalidates a manager PIN through the repository", async () => {
    const storedPinHash = await hashStaffPin("194827", pepper);
    const repository = stubRepository({
      revalidate: async (input) => {
        expect(await input.verifyPin(storedPinHash)).toBe(true);
        return { revalidatedAt: now, result: "revalidated" };
      }
    });
    const service = new StaffAuthService(repository, pepper, () => now);

    await expect(
      service.revalidate("c".repeat(43), { pin: "194827" })
    ).resolves.toEqual({ revalidatedAt: "2026-10-21T18:00:00.000Z" });
  });
});
