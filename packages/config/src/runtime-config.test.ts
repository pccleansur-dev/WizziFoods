import { describe, expect, it } from "vitest";

import {
  readApiConfig,
  readWebAuthConfig,
  readWebConfig,
  readWorkerConfig
} from "./runtime-config.js";

const baseEnvironment = {
  APP_ENV: "test",
  LOG_LEVEL: "info"
};
const apiInvitationEnvironment = {
  ADMIN_INVITE_REDIRECT_URL:
    "https://app.example.test/auth/callback?next=/acceso/continuar",
  PLATFORM_BASE_DOMAIN: "plataforma.example.test",
  SUPABASE_SECRET_KEY: "sb_secret_server-only-example"
};

describe("runtime configuration", () => {
  it("fails with all missing API variables named", () => {
    expect(() => readApiConfig({})).toThrow(
      "Configuración inválida para api: APP_ENV is required; LOG_LEVEL is required; API_PORT is required; API_METRICS_PORT is required; DATABASE_URL is required; SUPABASE_URL is required; SUPABASE_SECRET_KEY is required; ADMIN_INVITE_REDIRECT_URL is required; PLATFORM_BASE_DOMAIN is required; STAFF_PIN_PEPPER is required"
    );
  });

  it("parses validated API values", () => {
    expect(
      readApiConfig({
        ...baseEnvironment,
        ...apiInvitationEnvironment,
        API_METRICS_PORT: "9464",
        API_PORT: "3001",
        DATABASE_URL: "postgresql://authenticator:secret@db:5432/postgres",
        STAFF_PIN_PEPPER: "test-pepper-with-at-least-32-characters",
        SUPABASE_URL: "http://supabase.local:8000"
      })
    ).toEqual({
      environment: "test",
      anthropicApiKey: null,
      adminInviteRedirectUrl:
        "https://app.example.test/auth/callback?next=/acceso/continuar",
      databaseUrl: "postgresql://authenticator:secret@db:5432/postgres",
      logLevel: "info",
      mercadoPago: { mode: "off" },
      metricsPort: 9464,
      platformBaseDomain: "plataforma.example.test",
      paymentSecretKey: null,
      port: 3001,
      staffPinPepper: "test-pepper-with-at-least-32-characters",
      supabaseSecretKey: "sb_secret_server-only-example",
      supabaseUrl: "http://supabase.local:8000"
    });
  });

  it("reads an optional payment secret key and rejects malformed ones", () => {
    const env = {
      ...baseEnvironment,
      ...apiInvitationEnvironment,
      API_METRICS_PORT: "9464",
      API_PORT: "3001",
      DATABASE_URL: "postgresql://authenticator:secret@db:5432/postgres",
      STAFF_PIN_PEPPER: "test-pepper-with-at-least-32-characters",
      SUPABASE_URL: "http://supabase.local:8000"
    };
    const key = Buffer.alloc(32, 7).toString("base64");
    expect(
      readApiConfig({ ...env, PAYMENT_SECRET_KEY: key }).paymentSecretKey
    ).toEqual(Buffer.alloc(32, 7));
    expect(readApiConfig(env).paymentSecretKey).toBeNull();
    for (const bad of ["short", Buffer.alloc(16).toString("base64")]) {
      expect(() => readApiConfig({ ...env, PAYMENT_SECRET_KEY: bad })).toThrow(
        "PAYMENT_SECRET_KEY must be 32 random bytes in base64"
      );
    }
  });

  it("keeps online payments off unless asked, and checks every Mercado Pago variable", () => {
    const env = {
      ...baseEnvironment,
      ...apiInvitationEnvironment,
      API_METRICS_PORT: "9464",
      API_PORT: "3001",
      DATABASE_URL: "postgresql://authenticator:secret@db:5432/postgres",
      STAFF_PIN_PEPPER: "test-pepper-with-at-least-32-characters",
      SUPABASE_URL: "http://supabase.local:8000"
    };
    const key = Buffer.alloc(32, 7).toString("base64");
    const webhook = "webhook-secret-123456";
    expect(readApiConfig(env).mercadoPago).toEqual({ mode: "off" });
    expect(
      readApiConfig({ ...env, MERCADO_PAGO_MODE: "off" }).mercadoPago
    ).toEqual({ mode: "off" });
    expect(
      readApiConfig({
        ...env,
        MERCADO_PAGO_MODE: "fake",
        MERCADO_PAGO_WEBHOOK_SECRET: webhook,
        PAYMENT_SECRET_KEY: key
      }).mercadoPago
    ).toEqual({
      mode: "fake",
      redirectUri: "http://localhost:3001/v1/payments/mercado-pago/callback",
      returnUrl: "https://app.example.test/panel/pagos",
      webhookSecret: webhook
    });
    const live = {
      ...env,
      MERCADO_PAGO_CLIENT_ID: "1234567890",
      MERCADO_PAGO_CLIENT_SECRET: "client-secret",
      MERCADO_PAGO_MODE: "live",
      MERCADO_PAGO_REDIRECT_URI:
        "https://api.example.test/v1/payments/mercado-pago/callback",
      MERCADO_PAGO_RETURN_URL: "https://app.example.test/panel/pagos?mp=listo",
      MERCADO_PAGO_WEBHOOK_SECRET: webhook,
      PAYMENT_SECRET_KEY: key
    };
    expect(readApiConfig(live).mercadoPago).toMatchObject({
      clientId: "1234567890",
      mode: "live",
      returnUrl: "https://app.example.test/panel/pagos?mp=listo"
    });
    expect(() =>
      readApiConfig({ ...live, MERCADO_PAGO_MODE: "sandbox" })
    ).toThrow("MERCADO_PAGO_MODE must be off, fake or live");
    expect(() =>
      readApiConfig({
        ...live,
        APP_ENV: "production",
        MERCADO_PAGO_MODE: "fake"
      })
    ).toThrow("not allowed in production");
    expect(() =>
      readApiConfig({ ...live, PAYMENT_SECRET_KEY: undefined })
    ).toThrow("PAYMENT_SECRET_KEY is required for Mercado Pago");
    expect(() =>
      readApiConfig({ ...live, MERCADO_PAGO_WEBHOOK_SECRET: "short" })
    ).toThrow("at least 16 characters");
    expect(() =>
      readApiConfig({ ...live, MERCADO_PAGO_WEBHOOK_SECRET: undefined })
    ).toThrow("MERCADO_PAGO_WEBHOOK_SECRET is required");
    expect(() =>
      readApiConfig({
        ...live,
        MERCADO_PAGO_REDIRECT_URI: "http://api.example.test/cb"
      })
    ).toThrow("MERCADO_PAGO_REDIRECT_URI must be an absolute HTTPS URL");
    expect(() =>
      readApiConfig({ ...live, MERCADO_PAGO_CLIENT_SECRET: undefined })
    ).toThrow("MERCADO_PAGO_CLIENT_SECRET is required");
  });

  it("reads an optional translation provider key without exposing malformed ones", () => {
    const env = {
      ...baseEnvironment,
      ...apiInvitationEnvironment,
      API_METRICS_PORT: "9464",
      API_PORT: "3001",
      DATABASE_URL: "postgresql://authenticator:secret@db:5432/postgres",
      STAFF_PIN_PEPPER: "test-pepper-with-at-least-32-characters",
      SUPABASE_URL: "http://supabase.local:8000"
    };
    // Valores de prueba armados en pedazos: no son credenciales reales.
    const valid = ["sk", "ant", "test", "0123456789"].join("-");
    const malformed = ["not", "a", "provider", "value"].join("-");
    const variable = "ANTHROPIC_API_KEY";
    expect(readApiConfig(env).anthropicApiKey).toBeNull();
    expect(
      readApiConfig({ ...env, [variable]: `  ${valid}  ` }).anthropicApiKey
    ).toBe(valid);
    expect(() => readApiConfig({ ...env, [variable]: malformed })).toThrow(
      "ANTHROPIC_API_KEY must be an Anthropic API key"
    );
    try {
      readApiConfig({ ...env, [variable]: malformed });
    } catch (error) {
      expect((error as Error).message).not.toContain(malformed);
    }
  });

  it("rejects unsafe or malformed API ports", () => {
    expect(() =>
      readApiConfig({
        ...baseEnvironment,
        ...apiInvitationEnvironment,
        API_METRICS_PORT: "9464",
        API_PORT: "70000",
        DATABASE_URL: "postgresql://authenticator:secret@db:5432/postgres",
        STAFF_PIN_PEPPER: "test-pepper-with-at-least-32-characters",
        SUPABASE_URL: "http://supabase.local:8000"
      })
    ).toThrow("API_PORT must be an integer between 1 and 65535");
  });

  it("rejects a platform base domain with a scheme, port or uppercase", () => {
    expect(() =>
      readApiConfig({
        ...baseEnvironment,
        ...apiInvitationEnvironment,
        API_METRICS_PORT: "9464",
        API_PORT: "3001",
        DATABASE_URL: "postgresql://authenticator:secret@db:5432/postgres",
        PLATFORM_BASE_DOMAIN: "https://Plataforma.Example.Test:443",
        STAFF_PIN_PEPPER: "test-pepper-with-at-least-32-characters",
        SUPABASE_URL: "http://supabase.local:8000"
      })
    ).toThrow("PLATFORM_BASE_DOMAIN must be a canonical DNS hostname");
  });

  it("rejects non-PostgreSQL database URLs", () => {
    expect(() =>
      readApiConfig({
        ...baseEnvironment,
        ...apiInvitationEnvironment,
        API_METRICS_PORT: "9464",
        API_PORT: "3001",
        DATABASE_URL: "https://db.example.test",
        STAFF_PIN_PEPPER: "test-pepper-with-at-least-32-characters",
        SUPABASE_URL: "http://supabase.local:8000"
      })
    ).toThrow("DATABASE_URL must be an absolute PostgreSQL URL");
  });

  it("rejects a weak staff PIN pepper", () => {
    expect(() =>
      readApiConfig({
        ...baseEnvironment,
        ...apiInvitationEnvironment,
        API_METRICS_PORT: "9464",
        API_PORT: "3001",
        DATABASE_URL: "postgresql://authenticator:secret@db:5432/postgres",
        STAFF_PIN_PEPPER: "too-short",
        SUPABASE_URL: "http://supabase.local:8000"
      })
    ).toThrow("STAFF_PIN_PEPPER must have at least 32 characters");
  });

  it("requires an absolute HTTP API URL for web", () => {
    expect(() =>
      readWebConfig({
        ...baseEnvironment,
        NEXT_PUBLIC_API_URL: "javascript:alert(1)",
        WEB_METRICS_PORT: "9466"
      })
    ).toThrow("NEXT_PUBLIC_API_URL must be an absolute HTTP(S) URL");
  });

  it("parses the public web authentication boundary", () => {
    expect(
      readWebAuthConfig({
        NEXT_PUBLIC_APP_URL: "http://localhost:3000",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example",
        NEXT_PUBLIC_SUPABASE_URL: "http://localhost:18000"
      })
    ).toEqual({
      appUrl: "http://localhost:3000",
      supabasePublishableKey: "sb_publishable_example",
      supabaseUrl: "http://localhost:18000"
    });
  });

  it("rejects a secret Supabase key at the public web boundary", () => {
    expect(() =>
      readWebAuthConfig({
        NEXT_PUBLIC_APP_URL: "http://localhost:3000",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_secret_do-not-expose",
        NEXT_PUBLIC_SUPABASE_URL: "http://localhost:18000"
      })
    ).toThrow("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be publishable");
  });

  it("fails with all missing worker variables named", () => {
    expect(() => readWorkerConfig({})).toThrow(
      "Configuración inválida para worker: APP_ENV is required; LOG_LEVEL is required; DATABASE_URL is required; SUPABASE_URL is required; SUPABASE_SECRET_KEY is required; WORKER_HEARTBEAT_MS is required; WORKER_METRICS_PORT is required; WORKER_POLL_MS is required; WORKER_VISIBILITY_TIMEOUT_SECONDS is required"
    );
  });

  it("parses the worker queue and storage boundary", () => {
    expect(
      readWorkerConfig({
        ...baseEnvironment,
        DATABASE_URL: "postgresql://authenticator:secret@db:5432/postgres",
        SUPABASE_SECRET_KEY: "sb_secret_server-only-example",
        SUPABASE_URL: "http://supabase.local:8000",
        WORKER_METRICS_PORT: "9465",
        WORKER_HEARTBEAT_MS: "60000",
        WORKER_POLL_MS: "1000",
        WORKER_VISIBILITY_TIMEOUT_SECONDS: "120"
      })
    ).toEqual({
      databaseUrl: "postgresql://authenticator:secret@db:5432/postgres",
      environment: "test",
      heartbeatMs: 60_000,
      logLevel: "info",
      metricsPort: 9465,
      pollMs: 1_000,
      supabaseSecretKey: "sb_secret_server-only-example",
      supabaseUrl: "http://supabase.local:8000",
      visibilityTimeoutSeconds: 120
    });
  });

  it("rejects an unsafe worker secret", () => {
    expect(() =>
      readWorkerConfig({
        ...baseEnvironment,
        DATABASE_URL: "postgresql://authenticator:secret@db:5432/postgres",
        SUPABASE_SECRET_KEY: "public-key",
        SUPABASE_URL: "http://supabase.local:8000",
        WORKER_METRICS_PORT: "9465",
        WORKER_HEARTBEAT_MS: "60000",
        WORKER_POLL_MS: "0",
        WORKER_VISIBILITY_TIMEOUT_SECONDS: "3601"
      })
    ).toThrow("SUPABASE_SECRET_KEY must be a server secret key");
  });

  it("rejects unsafe worker queue timing", () => {
    expect(() =>
      readWorkerConfig({
        ...baseEnvironment,
        DATABASE_URL: "postgresql://authenticator:secret@db:5432/postgres",
        SUPABASE_SECRET_KEY: "sb_secret_server-only-example",
        SUPABASE_URL: "http://supabase.local:8000",
        WORKER_METRICS_PORT: "9465",
        WORKER_HEARTBEAT_MS: "60000",
        WORKER_POLL_MS: "0",
        WORKER_VISIBILITY_TIMEOUT_SECONDS: "3601"
      })
    ).toThrow("WORKER_POLL_MS must be an integer between 100 and 60000");
  });
});
