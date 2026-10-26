import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import type { TenantScope } from "@platform/contracts";

const ivLength = 12;
const tagLength = 16;

export const PAYMENT_SECRET_KEY_VERSION = 1;

/**
 * Seals provider credentials with AES-256-GCM before they reach the database.
 * The key lives only in the server environment. The tenant, location and method
 * are authenticated data, so a ciphertext copied to another row fails to open.
 * Mercado Pago and WhatsApp use this same class, each with its own `method`.
 */
export class PaymentSecretSealer {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) {
      throw new Error("payment secret key must be 32 bytes");
    }
  }

  seal(
    plaintext: string,
    scope: TenantScope,
    method: string
  ): { ciphertext: Buffer; keyVersion: number } {
    const iv = randomBytes(ivLength);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv, {
      authTagLength: tagLength
    });
    cipher.setAAD(this.aad(scope, method));
    const body = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final()
    ]);
    return {
      ciphertext: Buffer.concat([iv, cipher.getAuthTag(), body]),
      keyVersion: PAYMENT_SECRET_KEY_VERSION
    };
  }

  /** For server-side flows only; no endpoint exposes the result. */
  open(ciphertext: Buffer, scope: TenantScope, method: string): string {
    if (ciphertext.length < ivLength + tagLength + 1) {
      throw new Error("sealed credential is malformed");
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      ciphertext.subarray(0, ivLength),
      { authTagLength: tagLength }
    );
    decipher.setAAD(this.aad(scope, method));
    decipher.setAuthTag(ciphertext.subarray(ivLength, ivLength + tagLength));
    return Buffer.concat([
      decipher.update(ciphertext.subarray(ivLength + tagLength)),
      decipher.final()
    ]).toString("utf8");
  }

  private aad(scope: TenantScope, method: string): Buffer {
    return Buffer.from(
      `${scope.tenantId}:${scope.locationId}:${method}`,
      "utf8"
    );
  }
}
