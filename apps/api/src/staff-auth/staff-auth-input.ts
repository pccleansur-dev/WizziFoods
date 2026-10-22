import type {
  StaffLoginRequest,
  StaffRevalidationRequest
} from "@platform/contracts";

const tenantSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const usernamePattern = /^[a-z0-9](?:[a-z0-9._-]{1,62}[a-z0-9])?$/u;
const accessTokenPattern = /^[A-Za-z0-9_-]{43}$/u;
const pinPattern = /^\d{6}$/u;

export function parseStaffAccessToken(value: string | undefined): string {
  if (!value?.startsWith("Bearer ")) {
    throw new Error("Sesión inválida.");
  }

  const token = value.slice("Bearer ".length);
  if (!accessTokenPattern.test(token)) {
    throw new Error("Sesión inválida.");
  }
  return token;
}

export function parseStaffRevalidation(
  input: unknown
): StaffRevalidationRequest {
  if (!input || typeof input !== "object") {
    throw new Error("PIN inválido.");
  }

  const pin = (input as Record<string, unknown>).pin;
  if (typeof pin !== "string" || !pinPattern.test(pin)) {
    throw new Error("PIN inválido.");
  }
  return { pin };
}

export function parseStaffLogin(input: unknown): StaffLoginRequest {
  if (!input || typeof input !== "object") {
    throw new Error("Datos de acceso inválidos.");
  }

  const value = input as Record<string, unknown>;
  const pin = value.pin;
  const rawUsername = value.username;
  if (typeof pin !== "string" || typeof rawUsername !== "string") {
    throw new Error("Datos de acceso inválidos.");
  }

  const username = rawUsername.trim().normalize("NFKC").toLowerCase();
  if (!pinPattern.test(pin) || !usernamePattern.test(username)) {
    throw new Error("Datos de acceso inválidos.");
  }

  return { pin, username };
}

export function parseTenantSlug(value: string): string {
  if (value.length > 80 || !tenantSlugPattern.test(value)) {
    throw new Error("Negocio inválido.");
  }
  return value;
}
