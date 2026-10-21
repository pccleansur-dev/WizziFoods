import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

import { SupabaseJwtVerifier } from "./supabase-jwt.verifier.js";

describe("SupabaseJwtVerifier", () => {
  const issuer = "https://auth.example.test/auth/v1";
  let privateKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
  let verifier: SupabaseJwtVerifier;

  beforeAll(async () => {
    const pair = await generateKeyPair("ES256", { extractable: true });
    privateKey = pair.privateKey;
    const publicJwk = await exportJWK(pair.publicKey);
    verifier = new SupabaseJwtVerifier(
      issuer,
      createLocalJWKSet({ keys: [{ ...publicJwk, alg: "ES256", kid: "test" }] })
    );
  });

  async function tokenFor(
    tokenIssuer: string,
    expiration: string | number | Date = "5m"
  ): Promise<string> {
    return new SignJWT({
      aal: "aal2",
      role: "authenticated",
      session_id: "70000000-0000-4000-8000-000000000007"
    })
      .setProtectedHeader({ alg: "ES256", kid: "test" })
      .setSubject("10000000-0000-4000-8000-000000000001")
      .setAudience("authenticated")
      .setIssuer(tokenIssuer)
      .setIssuedAt()
      .setExpirationTime(expiration)
      .sign(privateKey);
  }

  it("verifies a current Supabase user token", async () => {
    await expect(
      verifier.verify(await tokenFor(issuer))
    ).resolves.toMatchObject({
      aal: "aal2",
      aud: "authenticated",
      role: "authenticated",
      sessionId: "70000000-0000-4000-8000-000000000007",
      sub: "10000000-0000-4000-8000-000000000001"
    });
  });

  it("rejects a correctly signed token from another issuer", async () => {
    await expect(
      verifier.verify(await tokenFor("https://attacker.example/auth/v1"))
    ).rejects.toThrow();
  });

  it("rejects an expired Supabase user token", async () => {
    await expect(verifier.verify(await tokenFor(issuer, 1))).rejects.toThrow();
  });
});
