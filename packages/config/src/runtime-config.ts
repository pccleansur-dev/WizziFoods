export type AppEnvironment = "development" | "test" | "production";
export type LogLevel = "debug" | "info" | "warn" | "error";

type EnvironmentSource = Readonly<Record<string, string | undefined>>;

export type BaseRuntimeConfig = {
  environment: AppEnvironment;
  logLevel: LogLevel;
};

export type ApiRuntimeConfig = BaseRuntimeConfig & {
  port: number;
};

export type WebRuntimeConfig = BaseRuntimeConfig & {
  apiUrl: string;
};

export type WorkerRuntimeConfig = BaseRuntimeConfig & {
  heartbeatMs: number;
};

function required(source: EnvironmentSource, key: string): string {
  const value = source[key]?.trim();

  if (!value) {
    throw new Error(`${key} is required`);
  }

  return value;
}

function assertRequired(source: EnvironmentSource, keys: string[]): void {
  const missing = keys.filter((key) => !source[key]?.trim());

  if (missing.length > 0) {
    throw new Error(missing.map((key) => `${key} is required`).join("; "));
  }
}

function readBaseConfig(source: EnvironmentSource): BaseRuntimeConfig {
  const errors: string[] = [];
  let environment: AppEnvironment | undefined;
  let logLevel: LogLevel | undefined;

  try {
    const value = required(source, "APP_ENV");
    if (!["development", "test", "production"].includes(value)) {
      throw new Error("APP_ENV must be development, test or production");
    }
    environment = value as AppEnvironment;
  } catch (error) {
    errors.push((error as Error).message);
  }

  try {
    const value = required(source, "LOG_LEVEL");
    if (!["debug", "info", "warn", "error"].includes(value)) {
      throw new Error("LOG_LEVEL must be debug, info, warn or error");
    }
    logLevel = value as LogLevel;
  } catch (error) {
    errors.push((error as Error).message);
  }

  if (errors.length > 0 || !environment || !logLevel) {
    throw new Error(errors.join("; "));
  }

  return { environment, logLevel };
}

function readInteger(
  source: EnvironmentSource,
  key: string,
  minimum: number,
  maximum: number
): number {
  const rawValue = required(source, key);
  const value = Number(rawValue);

  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(
      `${key} must be an integer between ${minimum} and ${maximum}`
    );
  }

  return value;
}

function withServiceContext<T>(service: string, read: () => T): T {
  try {
    return read();
  } catch (error) {
    throw new Error(
      `Configuración inválida para ${service}: ${(error as Error).message}`,
      { cause: error }
    );
  }
}

export function readApiConfig(source: EnvironmentSource): ApiRuntimeConfig {
  return withServiceContext("api", () => {
    assertRequired(source, ["APP_ENV", "LOG_LEVEL", "API_PORT"]);
    const base = readBaseConfig(source);
    const port = readInteger(source, "API_PORT", 1, 65_535);

    return { ...base, port };
  });
}

export function readWebConfig(source: EnvironmentSource): WebRuntimeConfig {
  return withServiceContext("web", () => {
    assertRequired(source, ["APP_ENV", "LOG_LEVEL", "NEXT_PUBLIC_API_URL"]);
    const base = readBaseConfig(source);
    const rawUrl = required(source, "NEXT_PUBLIC_API_URL");
    let apiUrl: URL;

    try {
      apiUrl = new URL(rawUrl);
    } catch {
      throw new Error("NEXT_PUBLIC_API_URL must be an absolute HTTP(S) URL");
    }

    if (apiUrl.protocol !== "http:" && apiUrl.protocol !== "https:") {
      throw new Error("NEXT_PUBLIC_API_URL must be an absolute HTTP(S) URL");
    }

    return { ...base, apiUrl: apiUrl.toString().replace(/\/$/, "") };
  });
}

export function readWorkerConfig(
  source: EnvironmentSource
): WorkerRuntimeConfig {
  return withServiceContext("worker", () => {
    assertRequired(source, ["APP_ENV", "LOG_LEVEL", "WORKER_HEARTBEAT_MS"]);
    const base = readBaseConfig(source);
    const heartbeatMs = readInteger(
      source,
      "WORKER_HEARTBEAT_MS",
      1_000,
      3_600_000
    );

    return { ...base, heartbeatMs };
  });
}
