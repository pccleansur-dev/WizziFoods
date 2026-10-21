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
      "Configuración inválida para api: APP_ENV is required; LOG_LEVEL is required; API_PORT is required"
    );
  });

  it("parses validated API values", () => {
    expect(readApiConfig({ ...baseEnvironment, API_PORT: "3001" })).toEqual({
      environment: "test",
      logLevel: "info",
      port: 3001
    });
  });

  it("rejects unsafe or malformed API ports", () => {
    expect(() =>
      readApiConfig({ ...baseEnvironment, API_PORT: "70000" })
    ).toThrow("API_PORT must be an integer between 1 and 65535");
  });

  it("requires an absolute HTTP API URL for web", () => {
    expect(() =>
      readWebConfig({
        ...baseEnvironment,
        NEXT_PUBLIC_API_URL: "javascript:alert(1)"
      })
    ).toThrow("NEXT_PUBLIC_API_URL must be an absolute HTTP(S) URL");
  });

  it("parses the worker heartbeat interval", () => {
    expect(
      readWorkerConfig({
        ...baseEnvironment,
        WORKER_HEARTBEAT_MS: "60000"
      })
    ).toEqual({
      environment: "test",
      heartbeatMs: 60_000,
      logLevel: "info"
    });
  });
});
