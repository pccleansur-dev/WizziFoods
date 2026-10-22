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
  SUPABASE_SECRET_KEY: "sb_secret_server-only-example"
};

describe("runtime configuration", () => {
  it("fails with all missing API variables named", () => {
    expect(() => readApiConfig({})).toThrow(
      "Configuración inválida para api: APP_ENV is required; LOG_LEVEL is required; API_PORT is required; API_METRICS_PORT is required; DATABASE_URL is required; SUPABASE_URL is required; SUPABASE_SECRET_KEY is required; ADMIN_INVITE_REDIRECT_URL is required; STAFF_PIN_PEPPER is required"
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
      adminInviteRedirectUrl:
        "https://app.example.test/auth/callback?next=/acceso/continuar",
      databaseUrl: "postgresql://authenticator:secret@db:5432/postgres",
      logLevel: "info",
      metricsPort: 9464,
      port: 3001,
      staffPinPepper: "test-pepper-with-at-least-32-characters",
      supabaseSecretKey: "sb_secret_server-only-example",
      supabaseUrl: "http://supabase.local:8000"
    });
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

  it("parses the worker heartbeat interval", () => {
    expect(
      readWorkerConfig({
        ...baseEnvironment,
        WORKER_METRICS_PORT: "9465",
        WORKER_HEARTBEAT_MS: "60000"
      })
    ).toEqual({
      environment: "test",
      heartbeatMs: 60_000,
      logLevel: "info",
      metricsPort: 9465
    });
  });
});
