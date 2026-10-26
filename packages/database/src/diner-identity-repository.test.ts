import { describe, expect, it, vi } from "vitest";

import { createDinerIdentityRepository } from "./diner-identity-repository.js";

const tenantId = "2f000000-0000-4000-8000-000000000001";
const locationId = "2f000000-0000-4000-8000-000000000002";
const accountId = "2f000000-0000-4000-8000-000000000003";
const commandId = "2f000000-0000-4000-8000-000000000004";
const profileId = "2f000000-0000-4000-8000-000000000005";
const digest = Buffer.alloc(32, 7);

function clientReturning(row: unknown) {
  return vi.fn(() => Promise.resolve([row]));
}

function values(client: ReturnType<typeof vi.fn>): unknown[] {
  return (client.mock.calls[0] as unknown[]).slice(1);
}

const state = { at: null, granted: false, textVersion: null };
const view = {
  profile: {
    consents: { marketing: state, whatsapp_verified: state },
    displayName: "Ana",
    profileId,
    whatsappPhone: null
  },
  texts: []
};

describe("diner identity repository", () => {
  it("saves a profile for the tenant and account it is given, nothing else", async () => {
    const client = clientReturning({ result: view });
    const result = await createDinerIdentityRepository(
      client as never
    ).saveProfile({
      accountId,
      request: { displayName: "Ana", whatsappPhone: null },
      tenantId
    });
    expect(result.profile?.displayName).toBe("Ana");
    expect(values(client)).toEqual([tenantId, accountId, "Ana", null]);
  });

  it("refuses a malformed result instead of passing it on", async () => {
    const client = clientReturning({
      result: { ...view, profile: { ...view.profile, accountId } }
    });
    await expect(
      createDinerIdentityRepository(client as never).getProfile({
        accountId,
        tenantId
      })
    ).rejects.toThrow("profile must be canonical");
  });

  it("records a consent with its version and origin", async () => {
    const client = clientReturning({ result: view });
    await createDinerIdentityRepository(client as never).recordConsent({
      accountId,
      request: {
        action: "granted",
        commandId,
        kind: "marketing",
        source: "menu",
        textVersion: 2
      },
      tenantId
    });
    expect(values(client)).toEqual([
      tenantId,
      accountId,
      commandId,
      "marketing",
      "granted",
      2,
      "menu"
    ]);
  });

  it("links with the canonical scope and the QR token", async () => {
    const client = clientReturning({ result: { linked: true } });
    const result = await createDinerIdentityRepository(
      client as never
    ).linkToSession({
      accountId,
      scope: { locationId, tenantId },
      token: "a".repeat(64)
    });
    expect(result).toEqual({ linked: true });
    expect(values(client)).toEqual([
      tenantId,
      locationId,
      accountId,
      "a".repeat(64)
    ]);
  });

  it("rejects hashes that are not SHA-256 digests", async () => {
    const repository = createDinerIdentityRepository(vi.fn() as never);
    await expect(
      repository.resolveSession({ tenantId, tokenHash: Buffer.alloc(5) })
    ).rejects.toThrow("SHA-256");
    await expect(
      repository.upsertAccount({ email: "a@b.co", subHash: "nope" })
    ).rejects.toThrow("SHA-256");
  });

  it("returns null for a session or code that does not resolve", async () => {
    const client = clientReturning({ account_id: null });
    const repository = createDinerIdentityRepository(client as never);
    expect(
      await repository.resolveSession({ tenantId, tokenHash: digest })
    ).toBeNull();
    expect(
      await repository.redeemLogin({
        codeHash: digest,
        sessionHash: digest,
        tenantId
      })
    ).toBeNull();
  });

  it("anonymizes and reports when", async () => {
    const client = clientReturning({
      result: { anonymizedAt: "2026-10-28T12:00:00.000Z" }
    });
    const at = await createDinerIdentityRepository(client as never).anonymize(
      accountId
    );
    expect(at.toISOString()).toBe("2026-10-28T12:00:00.000Z");
  });
});
