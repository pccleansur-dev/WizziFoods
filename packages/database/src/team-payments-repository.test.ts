import { PAYMENT_METHOD_KEYS } from "@platform/contracts";
import { describe, expect, it, vi } from "vitest";

import { createPaymentMethodsRepository } from "./payment-methods-repository.js";
import { createTeamRepository } from "./team-repository.js";

const scope = {
  locationId: "a8000000-0000-4000-8000-000000000008",
  tenantId: "a3000000-0000-4000-8000-000000000003"
};
const requesterId = "a1000000-0000-4000-8000-000000000001";
const memberId = "a2000000-0000-4000-8000-000000000002";
const hash = "scrypt-v1$c2FsdA$aGFzaA";

const unreachableClient = (() => {
  throw new Error("The database must not be queried");
}) as never;

function clientReturning(rows: unknown[]) {
  return vi.fn(() => Promise.resolve(rows)) as never;
}

const memberRow = {
  createdAt: "2026-10-24T00:00:00Z",
  displayName: "Ana",
  id: memberId,
  isActive: true,
  role: "waiter",
  sectorIds: [],
  username: "ana"
};

function statuses(extra: Record<string, unknown> = {}) {
  return PAYMENT_METHOD_KEYS.map((method) => ({
    available: method === "cash",
    configured: false,
    enabled: method === "cash",
    method,
    publicConfig: {},
    updatedAt: "2026-10-24T00:00:00Z",
    ...extra
  }));
}

describe("team repository", () => {
  it("maps canonical members", async () => {
    const client = clientReturning([{ result: [memberRow] }]);
    await expect(
      createTeamRepository(client).list(scope, requesterId)
    ).resolves.toEqual([memberRow]);
  });

  it("rejects rows that carry credential fields", async () => {
    const client = clientReturning([
      { result: [{ ...memberRow, pinHash: hash }] }
    ]);
    await expect(
      createTeamRepository(client).list(scope, requesterId)
    ).rejects.toThrow("canonical");
  });

  it("refuses a non-canonical scope or ids before querying", async () => {
    const repo = createTeamRepository(unreachableClient);
    await expect(
      repo.list({ ...scope, tenantId: "x" }, requesterId)
    ).rejects.toThrow();
    await expect(
      repo.setActive({ active: false, memberId: "x", requesterId, scope })
    ).rejects.toThrow("memberId");
    await expect(
      repo.create({
        member: {
          displayName: "Ana",
          role: "waiter",
          sectorIds: [],
          username: "ana"
        },
        pinHash: "123456",
        requesterId,
        scope
      })
    ).rejects.toThrow("hash");
  });

  it("passes only the hash and scope derived by the caller", async () => {
    const client = clientReturning([{ result: memberRow }]);
    await createTeamRepository(client).create({
      member: {
        displayName: "Ana",
        role: "waiter",
        sectorIds: [],
        username: "ana"
      },
      pinHash: hash,
      requesterId,
      scope
    });
    const values = (client as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0]!.slice(1);
    expect(values).toContain(hash);
    expect(values).not.toContain("123456");
  });
});

describe("payment methods repository", () => {
  it("maps state-only statuses", async () => {
    const client = clientReturning([{ result: statuses() }]);
    const result = await createPaymentMethodsRepository(client).list(
      scope,
      requesterId
    );
    expect(result).toHaveLength(5);
    expect(JSON.stringify(result)).not.toMatch(/ciphertext|secret/u);
  });

  it("rejects a view that leaks credential material", async () => {
    const client = clientReturning([
      { result: statuses({ ciphertext: "\\x00" }) }
    ]);
    await expect(
      createPaymentMethodsRepository(client).list(scope, requesterId)
    ).rejects.toThrow("canonical");
  });

  it("validates the key version and scope before sealing a credential", async () => {
    const repo = createPaymentMethodsRepository(unreachableClient);
    await expect(
      repo.storeSecret({
        method: "mercado_pago",
        requesterId,
        scope,
        sealed: { ciphertext: new Uint8Array(40), keyVersion: 0 }
      })
    ).rejects.toThrow("keyVersion");
    await expect(
      repo.list({ ...scope, locationId: "x" }, requesterId)
    ).rejects.toThrow();
  });

  it("reports readiness from the available methods", async () => {
    const client = clientReturning([{ available_methods: 0 }]);
    await expect(
      createPaymentMethodsRepository(client).getReadiness(scope)
    ).resolves.toEqual({ availableMethods: 0, ready: false });
  });
});
