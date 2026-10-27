/*
 * Browser-facing hardening headers, in one place so the web and the API agree and a test
 * can say what they are.
 */

function origin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

export type CspSources = {
  apiUrl?: string | undefined;
  development: boolean;
  supabaseUrl?: string | undefined;
};

/**
 * What the pages may load and connect to. Scripts keep `'unsafe-inline'` because Next.js
 * bootstraps with inline scripts; moving to per-request nonces is the next step and does not
 * change anything else here. Everything else is closed.
 */
export function contentSecurityPolicy(options: CspSources): string {
  const api = origin(options.apiUrl);
  const supabase = origin(options.supabaseUrl);
  const socket = supabase ? supabase.replace(/^http/u, "ws") : null;
  const list = (...values: Array<string | null>) =>
    values.filter((value): value is string => value !== null).join(" ");
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${options.development ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src ${list("'self'", "data:", "blob:", supabase, api)}`,
    "font-src 'self' data:",
    `connect-src ${list("'self'", api, supabase, socket)}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    `form-action ${list("'self'", api)}`,
    "frame-ancestors 'none'"
  ].join("; ");
}

export function webSecurityHeaders(
  options: CspSources
): Array<{ key: string; value: string }> {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(options) },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
    },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    ...(options.development
      ? []
      : [
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains"
          }
        ])
  ];
}

export function apiSecurityHeaders(options: {
  production: boolean;
}): Record<string, string> {
  return {
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    ...(options.production
      ? {
          "strict-transport-security": "max-age=63072000; includeSubDomains"
        }
      : {})
  };
}
