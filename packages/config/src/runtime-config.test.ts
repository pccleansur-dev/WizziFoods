import { describe, expect, it } from "vitest";

import {
  readApiConfig,
  readWebConfig,
  readWorkerConfig
} from "./runtime-config.js";

const baseEnvironment = {
  APP_ENV: "test",
  LOG_LEVEL: "info"
};

describe("runtime configuration", () => {
  it("fails with all missing API variables named", () => {
    expect(() => readApiConfig({})).toThrow(
      "Configuración inválida para api: APP_ENV is required; LOG_LEVEL is required; API_PORT is required; API_METRICS_PORT is required; DATABASE_URL is required; SUPABASE_URL is required"
    );
  });

  it("parses validated API values", () => {
    expect(
      readApiConfig({
        ...baseEnvironment,
        API_METRICS_PORT: "9464",
        API_PORT: "3001",
        DATABASE_URL: "postgresql://authenticator:secret@db:5432/postgres",
        SUPABASE_URL: "http://supabase.local:8000"
      })
    ).toEqual({
      environment: "test",
      databaseUrl: "postgresql://authenticator:secret@db:5432/postgres",
      logLevel: "info",
      metricsPort: 9464,
      port: 3001,
      supabaseUrl: "http://supabase.local:8000"
    });
  });

  it("rejects unsafe or malformed API ports", () => {
    expect(() =>
      readApiConfig({
        ...baseEnvironment,
        API_METRICS_PORT: "9464",
        API_PORT: "70000",
        DATABASE_URL: "postgresql://authenticator:secret@db:5432/postgres",
        SUPABASE_URL: "http://supabase.local:8000"
      })
    ).toThrow("API_PORT must be an integer between 1 and 65535");
  });

  it("rejects non-PostgreSQL database URLs", () => {
    expect(() =>
      readApiConfig({
        ...baseEnvironment,
        API_METRICS_PORT: "9464",
        API_PORT: "3001",
        DATABASE_URL: "https://db.example.test",
        SUPABASE_URL: "http://supabase.local:8000"
      })
    ).toThrow("DATABASE_URL must be an absolute PostgreSQL URL");
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
