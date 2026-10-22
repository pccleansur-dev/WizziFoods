import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const derivedKeyLength = 32;
const saltLength = 32;
const scryptOptions = {
  N: 32_768,
  maxmem: 64 * 1024 * 1024,
  p: 1,
  r: 8
} as const;

function assertPepper(pepper: string): void {
  if (Buffer.byteLength(pepper, "utf8") < 32) {
    throw new Error("STAFF_PIN_PEPPER debe tener al menos 32 caracteres.");
  }
}

function isValidPin(pin: string): boolean {
  return /^\d{6}$/u.test(pin);
}

function deriveKey(pin: string, pepper: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      `${pepper}:${pin}`,
      salt,
      derivedKeyLength,
      scryptOptions,
      (error, key) => {
        if (error) reject(error);
        else resolve(key);
      }
    );
  });
}

export async function hashStaffPin(
  pin: string,
  pepper: string
): Promise<string> {
  if (!isValidPin(pin)) {
    throw new Error("El PIN debe tener exactamente seis dígitos.");
  }
  assertPepper(pepper);

  const salt = randomBytes(saltLength);
  const hash = await deriveKey(pin, pepper, salt);
  return `scrypt-v1$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export async function verifyStaffPin(
  pin: string,
  credential: string,
  pepper: string
): Promise<boolean> {
  if (!isValidPin(pin)) return false;
  assertPepper(pepper);

  const [version, encodedSalt, encodedHash, ...extra] = credential.split("$");
  if (
    version !== "scrypt-v1" ||
    !encodedSalt ||
    !encodedHash ||
    extra.length > 0
  ) {
    return false;
  }

  try {
    const salt = Buffer.from(encodedSalt, "base64url");
    const expected = Buffer.from(encodedHash, "base64url");
    if (salt.length !== saltLength || expected.length !== derivedKeyLength) {
      return false;
    }

    const actual = await deriveKey(pin, pepper, salt);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
