export type TenantContext = {
  location: { id: string; name: string };
  role: "admin";
  tenant: {
    id: string;
    name: string;
    slug: string;
    status: "active" | "draft" | "suspended";
  };
};

export type AdministrativeAccess = {
  access:
    | { type: "platform_superadmin" }
    | { type: "unassigned" }
    | { tenantContexts: TenantContext[]; type: "tenant_admin" };
  identity: {
    assuranceLevel: "aal2";
    userId: string;
  };
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function parseTenantContext(value: unknown): TenantContext | null {
  const context = record(value);
  const location = record(context?.location);
  const tenant = record(context?.tenant);
  const status = tenant?.status;

  if (
    context?.role !== "admin" ||
    !nonEmptyString(location?.id) ||
    !nonEmptyString(location.name) ||
    !nonEmptyString(tenant?.id) ||
    !nonEmptyString(tenant.name) ||
    !nonEmptyString(tenant.slug) ||
    (status !== "active" && status !== "draft" && status !== "suspended")
  ) {
    return null;
  }

  return {
    location: { id: location.id, name: location.name },
    role: "admin",
    tenant: {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      status
    }
  };
}

export function parseAdministrativeAccess(
  value: unknown
): AdministrativeAccess | null {
  const root = record(value);
  const data = record(root?.data);
  const access = record(data?.access);
  const identity = record(data?.identity);

  if (
    identity?.assuranceLevel !== "aal2" ||
    !nonEmptyString(identity.userId) ||
    !uuidPattern.test(identity.userId)
  ) {
    return null;
  }

  const parsedIdentity = {
    assuranceLevel: "aal2" as const,
    userId: identity.userId
  };

  if (access?.type === "platform_superadmin" || access?.type === "unassigned") {
    return { access: { type: access.type }, identity: parsedIdentity };
  }

  if (
    access?.type !== "tenant_admin" ||
    !Array.isArray(access.tenantContexts)
  ) {
    return null;
  }

  const tenantContexts = access.tenantContexts.map(parseTenantContext);
  if (tenantContexts.some((context) => context === null)) return null;

  return {
    access: {
      tenantContexts: tenantContexts as TenantContext[],
      type: "tenant_admin"
    },
    identity: parsedIdentity
  };
}
