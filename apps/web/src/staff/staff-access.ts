import type { StaffLoginRequest } from "@platform/contracts";

const tenantSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const usernamePattern = /^[a-z0-9](?:[a-z0-9._-]{1,62}[a-z0-9])?$/u;

export function parseStaffLoginForm(formData: FormData): {
  request: StaffLoginRequest;
  tenantSlug: string;
} {
  const pin = formData.get("pin");
  const rawTenantSlug = formData.get("tenantSlug");
  const rawUsername = formData.get("username");
  if (
    typeof pin !== "string" ||
    typeof rawTenantSlug !== "string" ||
    typeof rawUsername !== "string"
  ) {
    throw new Error("Datos de acceso inválidos.");
  }

  const tenantSlug = rawTenantSlug.trim();
  const username = rawUsername.trim().normalize("NFKC").toLowerCase();
  if (
    tenantSlug.length > 80 ||
    !tenantSlugPattern.test(tenantSlug) ||
    !/^\d{6}$/u.test(pin) ||
    !usernamePattern.test(username)
  ) {
    throw new Error("Datos de acceso inválidos.");
  }

  return { request: { pin, username }, tenantSlug };
}

export function staffSessionCookieName(tenantSlug: string): string {
  if (!tenantSlugPattern.test(tenantSlug)) {
    throw new Error("Negocio inválido.");
  }
  return `staff_session_${tenantSlug}`;
}
