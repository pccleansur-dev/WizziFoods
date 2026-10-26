import type { BrowserContextOptions } from "@playwright/test";

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const webPort = 3100;
export const apiPort = 3101;
export const e2eHostname = "e2e-entry.localhost";

const root = path.resolve(__dirname, "..");
const supabaseUrl = "http://localhost:18000";

function readEnvFile(file: string): Record<string, string> {
  const values: Record<string, string> = {};
  if (!existsSync(file)) return values;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/u)) {
    const match = /^([A-Z_0-9]+)=(.*)$/u.exec(line);
    if (match?.[1]) {
      values[match[1]] = (match[2] ?? "").replace(/^["']|["']$/gu, "");
    }
  }
  return values;
}

/** En una worktree los .env (ignorados) viven en el checkout principal. */
function mainCheckout(): string {
  try {
    const common = execFileSync("git", ["rev-parse", "--git-common-dir"], {
      cwd: root,
      encoding: "utf8"
    }).trim();
    return path.dirname(path.resolve(root, common));
  } catch {
    return root;
  }
}

function localEnv(...segments: string[]): Record<string, string> {
  const own = path.join(root, ...segments);
  return readEnvFile(
    existsSync(own) ? own : path.join(mainCheckout(), ...segments)
  );
}

function need(values: Record<string, string>, key: string): string {
  const value = values[key];
  if (!value) {
    throw new Error(
      `Falta ${key} en infra/supabase/.env (¿corriste infra:up?)`
    );
  }
  return value;
}

function poolerUrl(
  role: "authenticator" | "postgres" | "supabase_admin"
): string {
  const supabase = localEnv("infra", "supabase", ".env");
  const password = encodeURIComponent(need(supabase, "POSTGRES_PASSWORD"));
  return `postgresql://${role}.${need(supabase, "POOLER_TENANT_ID")}:${password}@127.0.0.1:54322/postgres`;
}

/** Administrative connection used only to seed and clean the e2e business. */
export function adminDatabaseUrl(): string {
  return poolerUrl("postgres");
}

/** Owner connection for local Supabase tables intentionally hidden from postgres. */
export function ownerDatabaseUrl(): string {
  return poolerUrl("supabase_admin");
}

/** Environment of the API and the web on side ports, apart from the demo. */
export function stackEnv(): Record<string, string> {
  const supabase = localEnv("infra", "supabase", ".env");
  const app = localEnv(".env");
  return {
    ...app,
    ADMIN_INVITE_REDIRECT_URL: `http://${e2eHostname}:${webPort}/auth/callback`,
    API_METRICS_PORT: "9574",
    API_PORT: String(apiPort),
    APP_ENV: "development",
    DATABASE_URL: poolerUrl("authenticator"),
    LOG_LEVEL: "error",
    DINER_AUTH_MODE: "fake",
    DINER_AUTH_STATE_SECRET: "e2e-diner-state-secret-with-32-characters",
    DINER_SUB_PEPPER: "e2e-diner-sub-pepper-with-32-characters",
    MERCADO_PAGO_MODE: "fake",
    MERCADO_PAGO_REDIRECT_URI: `http://localhost:${apiPort}/v1/payments/mercado-pago/callback`,
    MERCADO_PAGO_RETURN_URL: `http://${e2eHostname}:${webPort}/panel/pagos`,
    MERCADO_PAGO_WEBHOOK_SECRET: "e2e-mercado-pago-webhook-secret",
    NEXT_PUBLIC_API_URL: `http://localhost:${apiPort}`,
    NEXT_PUBLIC_APP_URL: `http://${e2eHostname}:${webPort}`,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: need(
      supabase,
      "SUPABASE_PUBLISHABLE_KEY"
    ),
    NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
    PLATFORM_BASE_DOMAIN: "dev.localhost",
    PAYMENT_SECRET_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    STAFF_PIN_PEPPER: "e2e-pepper-with-at-least-32-characters",
    SUPABASE_SECRET_KEY: need(supabase, "SUPABASE_SECRET_KEY"),
    SUPABASE_URL: supabaseUrl,
    WEB_METRICS_PORT: "9576",
    WHATSAPP_APP_SECRET: "e2e-whatsapp-app-secret-with-16-plus",
    WHATSAPP_MODE: "simulated",
    WHATSAPP_VERIFY_TOKEN: "e2e-whatsapp-verify-token-16-plus"
  };
}

/**
 * The project's options without the keys Playwright leaves undefined, which the
 * strict optional-property typing of `newContext` refuses to receive.
 */
export function contextOptions(use: object): BrowserContextOptions {
  return Object.fromEntries(
    Object.entries(use).filter(([, value]) => value !== undefined)
  ) as BrowserContextOptions;
}
