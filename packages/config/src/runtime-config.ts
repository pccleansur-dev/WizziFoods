export type AppEnvironment = "development" | "test" | "production";
export type LogLevel = "debug" | "info" | "warn" | "error";

type EnvironmentSource = Readonly<Record<string, string | undefined>>;

export type BaseRuntimeConfig = {
  environment: AppEnvironment;
  logLevel: LogLevel;
};

/**
 * How the API talks to Mercado Pago. `off` rejects every online payment, `fake`
 * is an in-process simulator for development and tests (refused in production),
 * and `live` uses the real OAuth application and REST API.
 */
export type MercadoPagoConfig =
  | { mode: "off" }
  | { mode: "fake"; returnUrl: string; webhookSecret: string }
  | {
      clientId: string;
      clientSecret: string;
      mode: "live";
      redirectUri: string;
      returnUrl: string;
      webhookSecret: string;
    };

export type ApiRuntimeConfig = BaseRuntimeConfig & {
  adminInviteRedirectUrl: string;
  /** Opcional: sin ella la traducción automática responde 503. */
  anthropicApiKey?: string | null;
  databaseUrl: string;
  /** Absent (or off) means online payments are not offered. */
  mercadoPago?: MercadoPagoConfig;
  metricsPort: number;
  platformBaseDomain: string;
  port: number;
  paymentSecretKey: Buffer | null;
  staffPinPepper: string;
  supabaseSecretKey: string;
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
  databaseUrl: string;
  heartbeatMs: number;
  metricsPort: number;
  pollMs: number;
  supabaseSecretKey: string;
  supabaseUrl: string;
  visibilityTimeoutSeconds: number;
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

function readCanonicalDomain(source: EnvironmentSource, key: string): string {
  const value = required(source, key);
  const labelPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

  if (
    value.length > 253 ||
    value !== value.toLowerCase() ||
    !value.includes(".") ||
    !value.split(".").every((label) => labelPattern.test(label))
  ) {
    throw new Error(`${key} must be a canonical DNS hostname`);
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

function readMercadoPagoConfig(
  source: EnvironmentSource,
  environment: AppEnvironment,
  paymentSecretKey: Buffer | null,
  adminInviteRedirectUrl: string
): MercadoPagoConfig {
  const mode = source.MERCADO_PAGO_MODE?.trim() || "off";
  if (!["off", "fake", "live"].includes(mode)) {
    throw new Error("MERCADO_PAGO_MODE must be off, fake or live");
  }
  if (mode === "off") return { mode: "off" };
  if (mode === "fake" && environment === "production") {
    throw new Error("MERCADO_PAGO_MODE fake is not allowed in production");
  }
  // Tokens are stored sealed: without the key nothing can be connected.
  if (!paymentSecretKey) {
    throw new Error("PAYMENT_SECRET_KEY is required for Mercado Pago");
  }
  const webhookSecret = required(source, "MERCADO_PAGO_WEBHOOK_SECRET");
  if (webhookSecret.length < 16) {
    throw new Error(
      "MERCADO_PAGO_WEBHOOK_SECRET must have at least 16 characters"
    );
  }
  const returnUrl = source.MERCADO_PAGO_RETURN_URL?.trim()
    ? readUrl(
        source,
        "MERCADO_PAGO_RETURN_URL",
        ["http:", "https:"],
        "an absolute HTTP(S) URL"
      )
    : new URL("/panel/pagos", adminInviteRedirectUrl).toString();
  if (mode === "fake") return { mode: "fake", returnUrl, webhookSecret };
  return {
    clientId: required(source, "MERCADO_PAGO_CLIENT_ID"),
    clientSecret: required(source, "MERCADO_PAGO_CLIENT_SECRET"),
    mode: "live",
    redirectUri: readUrl(
      source,
      "MERCADO_PAGO_REDIRECT_URI",
      ["https:"],
      "an absolute HTTPS URL"
    ),
    returnUrl,
    webhookSecret
  };
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
      "SUPABASE_SECRET_KEY",
      "ADMIN_INVITE_REDIRECT_URL",
      "PLATFORM_BASE_DOMAIN",
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
    const adminInviteRedirectUrl = readUrl(
      source,
      "ADMIN_INVITE_REDIRECT_URL",
      ["http:", "https:"],
      "an absolute HTTP(S) URL"
    );
    const platformBaseDomain = readCanonicalDomain(
      source,
      "PLATFORM_BASE_DOMAIN"
    );
    const supabaseSecretKey = required(source, "SUPABASE_SECRET_KEY");
    if (!supabaseSecretKey.startsWith("sb_secret_")) {
      throw new Error("SUPABASE_SECRET_KEY must be a server secret key");
    }
    const staffPinPepper = required(source, "STAFF_PIN_PEPPER");
    if (staffPinPepper.length < 32) {
      throw new Error("STAFF_PIN_PEPPER must have at least 32 characters");
    }
    // Optional so existing deployments keep booting; without it the API
    // refuses to store provider credentials instead of storing them weakly.
    const rawPaymentKey = source.PAYMENT_SECRET_KEY?.trim();
    let paymentSecretKey: Buffer | null = null;
    if (rawPaymentKey) {
      paymentSecretKey = Buffer.from(rawPaymentKey, "base64");
      if (
        paymentSecretKey.length !== 32 ||
        paymentSecretKey.toString("base64") !== rawPaymentKey
      ) {
        throw new Error("PAYMENT_SECRET_KEY must be 32 random bytes in base64");
      }
    }

    const rawAnthropicKey = source.ANTHROPIC_API_KEY?.trim();
    if (
      rawAnthropicKey &&
      !/^sk-ant-[A-Za-z0-9_-]{10,}$/u.test(rawAnthropicKey)
    ) {
      throw new Error("ANTHROPIC_API_KEY must be an Anthropic API key");
    }

    return {
      ...base,
      adminInviteRedirectUrl,
      anthropicApiKey: rawAnthropicKey || null,
      databaseUrl,
      mercadoPago: readMercadoPagoConfig(
        source,
        base.environment,
        paymentSecretKey,
        adminInviteRedirectUrl
      ),
      metricsPort,
      platformBaseDomain,
      port,
      paymentSecretKey,
      staffPinPepper,
      supabaseSecretKey,
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
      "DATABASE_URL",
      "SUPABASE_URL",
      "SUPABASE_SECRET_KEY",
      "WORKER_HEARTBEAT_MS",
      "WORKER_METRICS_PORT",
      "WORKER_POLL_MS",
      "WORKER_VISIBILITY_TIMEOUT_SECONDS"
    ]);
    const base = readBaseConfig(source);
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
    const supabaseSecretKey = required(source, "SUPABASE_SECRET_KEY");
    if (!supabaseSecretKey.startsWith("sb_secret_")) {
      throw new Error("SUPABASE_SECRET_KEY must be a server secret key");
    }
    const heartbeatMs = readInteger(
      source,
      "WORKER_HEARTBEAT_MS",
      1_000,
      3_600_000
    );
    const metricsPort = readInteger(source, "WORKER_METRICS_PORT", 1, 65_535);
    const pollMs = readInteger(source, "WORKER_POLL_MS", 100, 60_000);
    const visibilityTimeoutSeconds = readInteger(
      source,
      "WORKER_VISIBILITY_TIMEOUT_SECONDS",
      1,
      3_600
    );

    return {
      ...base,
      databaseUrl,
      heartbeatMs,
      metricsPort,
      pollMs,
      supabaseSecretKey,
      supabaseUrl,
      visibilityTimeoutSeconds
    };
  });
}
