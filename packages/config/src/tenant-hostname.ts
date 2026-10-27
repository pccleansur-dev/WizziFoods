/*
 * How a business gets its address. The platform finds a business by the exact hostname in
 * `tenant_domains`, so the address of a NEW business is the only thing that depends on the
 * naming scheme. It is a template, so moving to another scheme (a dedicated product domain,
 * for instance) is a change of configuration, not of code:
 *
 *   {slug}.{domain}          donjuan.plataforma.test        (default)
 *   {slug}-carta.{domain}    donjuan-carta.wizzi.com.ar     one level under the domain,
 *                            which a single wildcard certificate covers
 */
export const defaultTenantHostTemplate = "{slug}.{domain}";

const labelPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

function occurrences(text: string, token: string): number {
  return text.split(token).length - 1;
}

export function validateTenantHostTemplate(template: string): string {
  if (occurrences(template, "{slug}") !== 1) {
    throw new Error(
      "PLATFORM_TENANT_HOST_TEMPLATE must contain {slug} exactly once"
    );
  }
  if (occurrences(template, "{domain}") !== 1) {
    throw new Error(
      "PLATFORM_TENANT_HOST_TEMPLATE must contain {domain} exactly once"
    );
  }
  // What is left must only be able to form DNS labels.
  const literal = template.replace("{slug}", "").replace("{domain}", "");
  if (!/^[a-z0-9.-]*$/u.test(literal)) {
    throw new Error(
      "PLATFORM_TENANT_HOST_TEMPLATE may only add lowercase letters, digits, dots and hyphens"
    );
  }
  return template;
}

/** The hostname of a business, checked to be a valid DNS name. */
export function tenantHostname(
  template: string,
  slug: string,
  domain: string
): string {
  validateTenantHostTemplate(template);
  const hostname = template.replace("{slug}", slug).replace("{domain}", domain);
  if (hostname.length > 253) {
    throw new Error("the hostname of the business is too long");
  }
  for (const label of hostname.split(".")) {
    if (label.length > 63) {
      throw new Error("a label of the hostname exceeds 63 characters");
    }
    if (!labelPattern.test(label)) {
      throw new Error(`"${hostname}" is not a valid hostname`);
    }
  }
  return hostname;
}
