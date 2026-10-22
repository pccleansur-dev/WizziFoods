import type { CreateTenantProvisioningRequest } from "@platform/contracts";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export function parseIdempotencyKey(value: string | undefined): string {
  const key = value?.trim();
  if (!key || key.length > 255) {
    throw new Error("Falta una clave de operación válida.");
  }
  return key;
}

export function parseTenantProvisioningRequest(
  input: unknown
): CreateTenantProvisioningRequest {
  if (!input || typeof input !== "object") {
    throw new Error("Datos del negocio inválidos.");
  }

  const value = input as Record<string, unknown>;
  if (
    typeof value.adminEmail !== "string" ||
    typeof value.name !== "string" ||
    typeof value.slug !== "string"
  ) {
    throw new Error("Datos del negocio inválidos.");
  }

  const request = {
    adminEmail: value.adminEmail.trim().toLowerCase(),
    name: value.name.trim().normalize("NFKC"),
    slug: value.slug.trim().toLowerCase()
  };
  if (
    request.name.length < 2 ||
    request.name.length > 120 ||
    request.slug.length > 80 ||
    !slugPattern.test(request.slug) ||
    request.adminEmail.length > 254 ||
    !emailPattern.test(request.adminEmail)
  ) {
    throw new Error("Datos del negocio inválidos.");
  }
  return request;
}
