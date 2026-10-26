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
  | {
      mode: "fake";
      redirectUri: string;
      returnUrl: string;
      webhookSecret: string;
    }
  | {
      clientId: string;
      clientSecret: string;
      mode: "live";
      redirectUri: string;
      returnUrl: string;
      webhookSecret: string;
    };

/**
 * Optional diner login with Google (T28). `off` hides the button, `fake` is an
 * in-process Google for development and tests (refused in production) and `live`
 * uses Google's OpenID Connect. The state secret signs the round trip through
 * Google; the sub pepper keys the hash of the Google subject we store.
 */
export type DinerAuthConfig =
  | { mode: "off" }
  | {
      mode: "fake";
      redirectUri: string;
      stateSecret: string;
      subPepper: string;
    }
  | {
      clientId: string;
      clientSecret: string;
      mode: "live";
      redirectUri: string;
      stateSecret: string;
      subPepper: string;
    };

/**
 * WhatsApp: off by default. "simulated" sends nothing (never in production); "meta"
 * talks to the WhatsApp Cloud API. The app secret signs the webhook, the verify token
 * answers Meta's handshake.
 */
export type WhatsappConfig =
  | { mode: "off" }
  | {
      appSecret: string;
      graphVersion: string;
      mode: "meta" | "simulated";
      verifyToken: string;
    };

/**
 * Notifications of the installed PWA (Web Push), signed with VAPID. "simulated" sends
 * nothing and is refused in production. The private key only exists where messages are
 * sent (the worker); the API only needs the public one, which the browser subscribes with.
 */
export type WebPushConfig =
  | { mode: "off" }
  | {
      mode: "live" | "simulated";
      privateKey: string | null;
      publicKey: string;
      subject: string;
    };

export type ApiRuntimeConfig = BaseRuntimeConfig & {
  adminInviteRedirectUrl: string;
  /** Absent (or off) means diners can only continue without an account. */
  dinerAuth?: DinerAuthConfig;
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
  /** Absent (or off) means no message is ever sent. */
  whatsapp?: WhatsappConfig;
  /** Absent (or off) means the PWA does not offer notifications. */
  webPush?: WebPushConfig;
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
  paymentSecretKey: Buffer | null;
  pollMs: number;
  webPush: WebPushConfig;
  whatsapp: WhatsappConfig;
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

function readPaymentSecretKey(source: EnvironmentSource): Buffer | null {
  const raw = source.PAYMENT_SECRET_KEY?.trim();
  if (!raw) return null;
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32 || key.toString("base64") !== raw) {
    throw new Error("PAYMENT_SECRET_KEY must be 32 random bytes in base64");
  }
  return key;
}

function readWebPushConfig(
  source: EnvironmentSource,
  environment: AppEnvironment,
  includePrivateKey: boolean
): WebPushConfig {
  const mode = source.WEB_PUSH_MODE?.trim() || "off";
  if (!["off", "simulated", "live"].includes(mode)) {
    throw new Error("WEB_PUSH_MODE must be off, simulated or live");
  }
  if (mode === "off") return { mode: "off" };
  if (mode === "simulated" && environment === "production") {
    throw new Error("WEB_PUSH_MODE simulated is not allowed in production");
  }
  const publicKey = required(source, "WEB_PUSH_PUBLIC_KEY");
  const publicBytes = Buffer.from(publicKey, "base64url");
  if (
    publicBytes.length !== 65 ||
    publicBytes[0] !== 4 ||
    publicBytes.toString("base64url") !== publicKey
  ) {
    throw new Error(
      "WEB_PUSH_PUBLIC_KEY must be an uncompressed P-256 key in base64url"
    );
  }
  let privateKey: string | null = null;
  if (includePrivateKey) {
    privateKey = required(source, "WEB_PUSH_PRIVATE_KEY");
    const privateBytes = Buffer.from(privateKey, "base64url");
    if (
      privateBytes.length !== 32 ||
      privateBytes.toString("base64url") !== privateKey
    ) {
      throw new Error("WEB_PUSH_PRIVATE_KEY must be 32 bytes in base64url");
    }
  }
  const subject = required(source, "WEB_PUSH_SUBJECT");
  if (!/^(mailto:[^\s@]+@[^\s@]+|https:\/\/[^\s]+)$/u.test(subject)) {
    throw new Error("WEB_PUSH_SUBJECT must be a mailto: or https: contact");
  }
  return { mode: mode as "live" | "simulated", privateKey, publicKey, subject };
}

function readWhatsappConfig(
  source: EnvironmentSource,
  environment: AppEnvironment,
  paymentSecretKey: Buffer | null
): WhatsappConfig {
  const mode = source.WHATSAPP_MODE?.trim() || "off";
  if (!["off", "simulated", "meta"].includes(mode)) {
    throw new Error("WHATSAPP_MODE must be off, simulated or meta");
  }
  if (mode === "off") return { mode: "off" };
  if (mode === "simulated" && environment === "production") {
    throw new Error("WHATSAPP_MODE simulated is not allowed in production");
  }
  // Tokens are stored sealed: without the key nothing can be connected or sent.
  if (!paymentSecretKey) {
    throw new Error("PAYMENT_SECRET_KEY is required for WhatsApp");
  }
  const appSecret = required(source, "WHATSAPP_APP_SECRET");
  const verifyToken = required(source, "WHATSAPP_VERIFY_TOKEN");
  if (appSecret.length < 16 || verifyToken.length < 16) {
    throw new Error(
      "WHATSAPP_APP_SECRET and WHATSAPP_VERIFY_TOKEN must have at least 16 characters"
    );
  }
  const graphVersion = source.WHATSAPP_GRAPH_VERSION?.trim() || "v21.0";
  if (!/^v\d+\.\d+$/u.test(graphVersion)) {
    throw new Error("WHATSAPP_GRAPH_VERSION must look like v21.0");
  }
  return {
    appSecret,
    graphVersion,
    mode: mode as "meta" | "simulated",
    verifyToken
  };
}

function readMercadoPagoConfig(
  source: EnvironmentSource,
  environment: AppEnvironment,
  paymentSecretKey: Buffer | null,
  adminInviteRedirectUrl: string,
  port: number
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
  if (mode === "fake") {
    return {
      mode: "fake",
      redirectUri: source.MERCADO_PAGO_REDIRECT_URI?.trim()
        ? readUrl(
            source,
            "MERCADO_PAGO_REDIRECT_URI",
            ["http:", "https:"],
            "an absolute HTTP(S) URL"
          )
        : `http://localhost:${port}/v1/payments/mercado-pago/callback`,
      returnUrl,
      webhookSecret
    };
  }
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

function readDinerAuthConfig(
  source: EnvironmentSource,
  environment: AppEnvironment,
  port: number
): DinerAuthConfig {
  const mode = source.DINER_AUTH_MODE?.trim() || "off";
  if (!["off", "fake", "live"].includes(mode)) {
    throw new Error("DINER_AUTH_MODE must be off, fake or live");
  }
  if (mode === "off") return { mode: "off" };
  if (mode === "fake" && environment === "production") {
    throw new Error("DINER_AUTH_MODE fake is not allowed in production");
  }
  const stateSecret = required(source, "DINER_AUTH_STATE_SECRET");
  const subPepper = required(source, "DINER_SUB_PEPPER");
  if (stateSecret.length < 32 || subPepper.length < 32) {
    throw new Error(
      "DINER_AUTH_STATE_SECRET and DINER_SUB_PEPPER must have at least 32 characters"
    );
  }
  if (mode === "fake") {
    return {
      mode: "fake",
      redirectUri: source.DINER_AUTH_REDIRECT_URI?.trim()
        ? readUrl(
            source,
            "DINER_AUTH_REDIRECT_URI",
            ["http:", "https:"],
            "an absolute HTTP(S) URL"
          )
        : `http://localhost:${port}/v1/diner-auth/google/callback`,
      stateSecret,
      subPepper
    };
  }
  return {
    clientId: required(source, "GOOGLE_DINER_CLIENT_ID"),
    clientSecret: required(source, "GOOGLE_DINER_CLIENT_SECRET"),
    mode: "live",
    redirectUri: readUrl(
      source,
      "DINER_AUTH_REDIRECT_URI",
      ["https:"],
      "an absolute HTTPS URL"
    ),
    stateSecret,
    subPepper
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
    const paymentSecretKey = readPaymentSecretKey(source);

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
      dinerAuth: readDinerAuthConfig(source, base.environment, port),
      mercadoPago: readMercadoPagoConfig(
        source,
        base.environment,
        paymentSecretKey,
        adminInviteRedirectUrl,
        port
      ),
      metricsPort,
      platformBaseDomain,
      port,
      paymentSecretKey,
      staffPinPepper,
      supabaseSecretKey,
      supabaseUrl,
      webPush: readWebPushConfig(source, base.environment, false),
      whatsapp: readWhatsappConfig(source, base.environment, paymentSecretKey)
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

    const paymentSecretKey = readPaymentSecretKey(source);

    return {
      ...base,
      databaseUrl,
      heartbeatMs,
      metricsPort,
      paymentSecretKey,
      pollMs,
      webPush: readWebPushConfig(source, base.environment, true),
      whatsapp: readWhatsappConfig(source, base.environment, paymentSecretKey),
      supabaseSecretKey,
      supabaseUrl,
      visibilityTimeoutSeconds
    };
  });
}
