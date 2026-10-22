export type AppEnvironment = "development" | "test" | "production";
export type LogLevel = "debug" | "info" | "warn" | "error";

type EnvironmentSource = Readonly<Record<string, string | undefined>>;

export type BaseRuntimeConfig = {
  environment: AppEnvironment;
  logLevel: LogLevel;
};

export type ApiRuntimeConfig = BaseRuntimeConfig & {
  databaseUrl: string;
  metricsPort: number;
  port: number;
  staffPinPepper: string;
  supabaseUrl: string;
};

export type WebRuntimeConfig = BaseRuntimeConfig & {
  apiUrl: string;
  metricsPort: number;
};

export type WebAuthConfig = {
  appUrl: string;
  supabasePublishableKey: string;
  supabaseUrl: string;
};

export type WorkerRuntimeConfig = BaseRuntimeConfig & {
  heartbeatMs: number;
  metricsPort: number;
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

function readUrl(
  source: EnvironmentSource,
  key: string,
  protocols: string[],
  description: string
): string {
  let url: URL;

  try {
    url = new URL(required(source, key));
  } catch {
    throw new Error(`${key} must be ${description}`);
  }

  if (!protocols.includes(url.protocol)) {
    throw new Error(`${key} must be ${description}`);
  }

  return url.toString().replace(/\/$/u, "");
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
    assertRequired(source, [
      "APP_ENV",
      "LOG_LEVEL",
      "API_PORT",
      "API_METRICS_PORT",
      "DATABASE_URL",
      "SUPABASE_URL",
      "STAFF_PIN_PEPPER"
    ]);
    const base = readBaseConfig(source);
    const port = readInteger(source, "API_PORT", 1, 65_535);
    const metricsPort = readInteger(source, "API_METRICS_PORT", 1, 65_535);
    const databaseUrl = readUrl(
      source,
      "DATABASE_URL",
      ["postgres:", "postgresql:"],
      "an absolute PostgreSQL URL"
    );
    const supabaseUrl = readUrl(
      source,
      "SUPABASE_URL",
      ["http:", "https:"],
      "an absolute HTTP(S) URL"
    );
    const staffPinPepper = required(source, "STAFF_PIN_PEPPER");
    if (staffPinPepper.length < 32) {
      throw new Error("STAFF_PIN_PEPPER must have at least 32 characters");
    }

    return {
      ...base,
      databaseUrl,
      metricsPort,
      port,
      staffPinPepper,
      supabaseUrl
    };
  });
}

export function readWebConfig(source: EnvironmentSource): WebRuntimeConfig {
  return withServiceContext("web", () => {
    assertRequired(source, [
      "APP_ENV",
      "LOG_LEVEL",
      "NEXT_PUBLIC_API_URL",
      "WEB_METRICS_PORT"
    ]);
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

    const metricsPort = readInteger(source, "WEB_METRICS_PORT", 1, 65_535);

    return {
      ...base,
      apiUrl: apiUrl.toString().replace(/\/$/, ""),
      metricsPort
    };
  });
}

export function readWebAuthConfig(source: EnvironmentSource): WebAuthConfig {
  return withServiceContext("web authentication", () => {
    assertRequired(source, [
      "NEXT_PUBLIC_APP_URL",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "NEXT_PUBLIC_SUPABASE_URL"
    ]);
    const appUrl = readUrl(
      source,
      "NEXT_PUBLIC_APP_URL",
      ["http:", "https:"],
      "an absolute HTTP(S) URL"
    );
    const supabaseUrl = readUrl(
      source,
      "NEXT_PUBLIC_SUPABASE_URL",
      ["http:", "https:"],
      "an absolute HTTP(S) URL"
    );
    const supabasePublishableKey = required(
      source,
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
    );

    if (
      !supabasePublishableKey.startsWith("sb_publishable_") ||
      supabasePublishableKey.length > 256
    ) {
      throw new Error(
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be publishable"
      );
    }

    return { appUrl, supabasePublishableKey, supabaseUrl };
  });
}

export function readWorkerConfig(
  source: EnvironmentSource
): WorkerRuntimeConfig {
  return withServiceContext("worker", () => {
    assertRequired(source, [
      "APP_ENV",
      "LOG_LEVEL",
      "WORKER_HEARTBEAT_MS",
      "WORKER_METRICS_PORT"
    ]);
    const base = readBaseConfig(source);
    const heartbeatMs = readInteger(
      source,
      "WORKER_HEARTBEAT_MS",
      1_000,
      3_600_000
    );
    const metricsPort = readInteger(source, "WORKER_METRICS_PORT", 1, 65_535);

    return { ...base, heartbeatMs, metricsPort };
  });
}
