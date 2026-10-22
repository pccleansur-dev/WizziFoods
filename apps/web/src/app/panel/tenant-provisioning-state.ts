export type TenantProvisioningActionState = {
  idempotencyKey: string;
  message: string;
  status: "idle" | "error" | "success";
};

export type ProvisionedTenant = {
  adminEmail: string;
  domain: { hostname: string };
  status: "invited" | "activated";
  tenant: { name: string; slug: string };
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

export function parseProvisionedTenant(
  value: unknown
): ProvisionedTenant | null {
  const root = record(value);
  const data = record(root?.data);
  const domain = record(data?.domain);
  const tenant = record(data?.tenant);
  if (
    typeof data?.adminEmail !== "string" ||
    data.adminEmail.length === 0 ||
    typeof domain?.hostname !== "string" ||
    domain.hostname.length === 0 ||
    (data.status !== "invited" && data.status !== "activated") ||
    typeof tenant?.name !== "string" ||
    tenant.name.length === 0 ||
    typeof tenant.slug !== "string" ||
    tenant.slug.length === 0
  ) {
    return null;
  }

  return {
    adminEmail: data.adminEmail,
    domain: { hostname: domain.hostname },
    status: data.status,
    tenant: { name: tenant.name, slug: tenant.slug }
  };
}
