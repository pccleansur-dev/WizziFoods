/*
 * Builds the environment of a production deployment: fresh random secrets for Supabase and
 * for the applications, and the public addresses derived from your domain.
 *
 *   pnpm deploy:env --domain example.com [--suffix carta] [--app app] [--api api] [--supabase supabase]
 *
 * Writes deploy-secrets/production.env (owner-only, ignored by Git) and prints NOTHING
 * secret. Paste its content into Coolify (Environment Variables -> Developer view). It
 * refuses to overwrite an existing file: regenerating secrets of a running system would lock
 * everyone out and make the stored payment tokens unreadable.
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { createSupabaseEnvironment } from "./supabase-env.js";

export type ProductionEnvOptions = {
  api: string;
  app: string;
  domain: string;
  supabase: string;
  /**
   * When set, every name is ONE level under the domain: app-<suffix>.<domain>, and a business
   * is <slug>-<suffix>.<domain>. One wildcard certificate (*.<domain>) then covers them all.
   */
  suffix?: string;
};

const hostPattern = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/u;
const domainPattern = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/u;

/** Sets KEY=value in an env-file text (the key must exist; production overrides a template). */
export function setValue(text: string, key: string, value: string): string {
  const pattern = new RegExp(`^${key}=.*$`, "m");
  if (!pattern.test(text)) {
    return `${text.replace(/\s*$/u, "")}\n${key}=${value}\n`;
  }
  return text.replace(pattern, () => `${key}=${value}`);
}

export function createProductionEnvironment(
  template: string,
  options: ProductionEnvOptions,
  now = Date.now()
): string {
  for (const label of [options.app, options.api, options.supabase]) {
    if (!hostPattern.test(label)) {
      throw new Error(`"${label}" is not a valid host label`);
    }
  }
  if (!domainPattern.test(options.domain)) {
    throw new Error(`"${options.domain}" is not a valid domain`);
  }
  if (options.suffix !== undefined && !hostPattern.test(options.suffix)) {
    throw new Error(`"${options.suffix}" is not a valid host label`);
  }
  const named = (label: string) =>
    options.suffix ? `${label}-${options.suffix}` : label;
  const appUrl = `https://${named(options.app)}.${options.domain}`;
  const apiUrl = `https://${named(options.api)}.${options.domain}`;
  const supabaseUrl = `https://${named(options.supabase)}.${options.domain}`;

  let text = createSupabaseEnvironment(template, now);
  const set = (key: string, value: string) => {
    text = setValue(text, key, value);
  };

  // Where the browser reaches Supabase, and where Auth sends people back.
  set("SUPABASE_PUBLIC_URL", supabaseUrl);
  set("API_EXTERNAL_URL", `${supabaseUrl}/auth/v1`);
  set("SITE_URL", appUrl);
  set("ADDITIONAL_REDIRECT_URLS", `${appUrl}/**`);
  // The platform creates accounts through its own flows; nobody signs up on their own.
  set("DISABLE_SIGNUP", "true");
  // Mail: an SMTP provider must be configured before invitations and password recovery work.
  set("SMTP_HOST", "");
  set("SMTP_PORT", "587");
  set("SMTP_USER", "");
  set("SMTP_PASS", "");
  set("SMTP_ADMIN_EMAIL", `no-reply@${options.domain}`);
  set("SMTP_SENDER_NAME", "La plataforma");
  // The gateway refuses to start without a user/password for its (undeployed) Studio route.
  set("DASHBOARD_USERNAME", "admin");

  // Applications.
  set("NEXT_PUBLIC_APP_URL", appUrl);
  set("NEXT_PUBLIC_API_URL", apiUrl);
  set("NEXT_PUBLIC_SUPABASE_URL", supabaseUrl);
  set("PLATFORM_BASE_DOMAIN", options.domain);
  set(
    "PLATFORM_TENANT_HOST_TEMPLATE",
    options.suffix ? `{slug}-${options.suffix}.{domain}` : "{slug}.{domain}"
  );
  set("STAFF_PIN_PEPPER", randomBytes(32).toString("base64"));
  set("PAYMENT_SECRET_KEY", randomBytes(32).toString("base64"));
  set("DINER_AUTH_STATE_SECRET", randomBytes(32).toString("base64"));
  set("DINER_SUB_PEPPER", randomBytes(32).toString("base64"));
  set("LOG_LEVEL", "info");
  // Optional modules start OFF; turn them on one by one when their accounts exist.
  set("MERCADO_PAGO_MODE", "off");
  set("WEB_PUSH_MODE", "off");
  set("WHATSAPP_MODE", "off");
  set("DINER_AUTH_MODE", "off");

  // Only what the production compose reads: drop the local-only and unused settings so the
  // file pasted into Coolify is short and every line means something.
  const keep = new Set([
    "ADDITIONAL_REDIRECT_URLS",
    "ANON_KEY",
    "ANON_KEY_ASYMMETRIC",
    "API_EXTERNAL_URL",
    "AUTH_AUDIT_LOG_DISABLE_POSTGRES",
    "DINER_AUTH_MODE",
    "DASHBOARD_PASSWORD",
    "DASHBOARD_USERNAME",
    "DINER_AUTH_STATE_SECRET",
    "DINER_SUB_PEPPER",
    "DISABLE_SIGNUP",
    "ENABLE_ANONYMOUS_USERS",
    "ENABLE_EMAIL_AUTOCONFIRM",
    "ENABLE_EMAIL_SIGNUP",
    "ENABLE_PHONE_AUTOCONFIRM",
    "ENABLE_PHONE_SIGNUP",
    "GLOBAL_S3_BUCKET",
    "IMGPROXY_AUTO_WEBP",
    "JWT_EXPIRY",
    "JWT_JWKS",
    "JWT_KEYS",
    "JWT_SECRET",
    "LOG_LEVEL",
    "MAILER_URLPATHS_CONFIRMATION",
    "MAILER_URLPATHS_EMAIL_CHANGE",
    "MAILER_URLPATHS_INVITE",
    "MAILER_URLPATHS_RECOVERY",
    "MERCADO_PAGO_MODE",
    "MFA_MAX_ENROLLED_FACTORS",
    "MFA_TOTP_ENROLL_ENABLED",
    "MFA_TOTP_VERIFY_ENABLED",
    "NEXT_PUBLIC_API_URL",
    "NEXT_PUBLIC_APP_URL",
    "NEXT_PUBLIC_SUPABASE_URL",
    "PAYMENT_SECRET_KEY",
    "PGRST_DB_EXTRA_SEARCH_PATH",
    "PGRST_DB_MAX_ROWS",
    "PGRST_DB_SCHEMAS",
    "PLATFORM_BASE_DOMAIN",
    "PLATFORM_TENANT_HOST_TEMPLATE",
    "POSTGRES_DB",
    "POSTGRES_HOST",
    "POSTGRES_PASSWORD",
    "POSTGRES_PORT",
    "REALTIME_DB_ENC_KEY",
    "REGION",
    "S3_PROTOCOL_ACCESS_KEY_ID",
    "S3_PROTOCOL_ACCESS_KEY_SECRET",
    "SECRET_KEY_BASE",
    "SERVICE_ROLE_KEY",
    "SERVICE_ROLE_KEY_ASYMMETRIC",
    "SITE_URL",
    "SMTP_ADMIN_EMAIL",
    "SMTP_HOST",
    "SMTP_PASS",
    "SMTP_PORT",
    "SMTP_SENDER_NAME",
    "SMTP_USER",
    "STAFF_PIN_PEPPER",
    "STORAGE_TENANT_ID",
    "SUPABASE_PUBLIC_URL",
    "SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SECRET_KEY",
    "WEB_PUSH_MODE",
    "WHATSAPP_MODE"
  ]);
  const lines = text
    .split(/\r?\n/u)
    .filter((line) => /^[A-Z0-9_]+=/u.test(line))
    .filter((line) => keep.has(line.slice(0, line.indexOf("="))));
  return `${lines.join("\n")}\n`;
}

function option(name: string, fallback: string | null): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

function main(): void {
  const domain = option("domain", null);
  if (!domain) {
    throw new Error("usage: pnpm deploy:env --domain example.com");
  }
  const options: ProductionEnvOptions = {
    api: option("api", "api") ?? "api",
    app: option("app", "app") ?? "app",
    domain,
    supabase: option("supabase", "supabase") ?? "supabase",
    ...(option("suffix", null) ? { suffix: option("suffix", null)! } : {})
  };
  const directory = path.resolve(process.cwd(), "deploy-secrets");
  const target = path.join(directory, "production.env");
  if (existsSync(target)) {
    throw new Error(
      "deploy-secrets/production.env already exists; it is not overwritten (see the header of this file)"
    );
  }
  const template = readFileSync(
    path.resolve(process.cwd(), "infra", "supabase", ".env.example"),
    "utf8"
  );
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeFileSync(target, createProductionEnvironment(template, options), {
    mode: 0o600
  });
  console.info(
    `Wrote deploy-secrets/production.env for ${domain} (app, api and supabase addresses derived from it). No secret was printed.`
  );
}

if (
  process.argv[1] &&
  import.meta.url.endsWith(path.basename(process.argv[1]))
) {
  main();
}
