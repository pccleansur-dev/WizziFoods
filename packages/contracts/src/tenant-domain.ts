export type TenantHostContext = {
  domain: { hostname: string; id: string };
  location: { id: string; name: string };
  tenant: { id: string; name: string; slug: string };
};

const dnsLabelPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const ipv4Pattern = /^\d+(?:\.\d+){3}$/u;

export function parseTenantHostname(authority: unknown): string | null {
  if (typeof authority !== "string") return null;

  const candidate = authority.trim().toLowerCase();
  const match = /^([^:]+)(?::([0-9]{1,5}))?$/u.exec(candidate);
  if (!match) return null;

  const port = match[2] ? Number(match[2]) : null;
  if (port !== null && (port < 1 || port > 65_535)) return null;

  const hostname = match[1]?.replace(/\.$/u, "") ?? "";
  if (
    hostname.length < 1 ||
    hostname.length > 253 ||
    !hostname.includes(".") ||
    ipv4Pattern.test(hostname)
  ) {
    return null;
  }

  const labels = hostname.split(".");
  return labels.every((label) => dnsLabelPattern.test(label)) ? hostname : null;
}
