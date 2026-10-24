export const PAYMENT_METHOD_KEYS = [
  "cash",
  "credit_card",
  "debit_card",
  "other_in_person",
  "mercado_pago"
] as const;

export type PaymentMethodKey = (typeof PAYMENT_METHOD_KEYS)[number];

export const paymentMethodLabels: Record<PaymentMethodKey, string> = {
  cash: "Efectivo",
  credit_card: "Tarjeta de crédito (presencial)",
  debit_card: "Tarjeta de débito (presencial)",
  mercado_pago: "Mercado Pago",
  other_in_person: "Otro medio presencial"
};

/** Methods that connect to an external provider and need a credential. */
export const PROVIDER_PAYMENT_METHODS: readonly PaymentMethodKey[] = [
  "mercado_pago"
];

export const PAYMENT_SECRET_LIMITS = { max: 512, min: 8 } as const;

export type PaymentPublicConfig = { publicKey?: string };

/**
 * What a read returns. There is deliberately no field for a credential: the
 * secret never leaves the server, only whether one is stored.
 */
export type PaymentMethodStatus = {
  available: boolean;
  configured: boolean;
  enabled: boolean;
  method: PaymentMethodKey;
  publicConfig: PaymentPublicConfig;
  updatedAt: string;
};

export type PaymentIssue = { code: string; message: string; path: string };

export type PaymentParseResult<T> =
  { issues: PaymentIssue[]; ok: false } | { ok: true; value: T };

const publicKeyPattern = /^[A-Za-z0-9_-]{8,200}$/u;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function isPaymentMethodKey(value: unknown): value is PaymentMethodKey {
  return (
    typeof value === "string" &&
    (PAYMENT_METHOD_KEYS as readonly string[]).includes(value)
  );
}

export function parsePaymentMethodKey(value: unknown): PaymentMethodKey | null {
  return isPaymentMethodKey(value) ? value : null;
}

function parsePublicConfig(
  value: unknown,
  method: PaymentMethodKey,
  issues: PaymentIssue[]
): PaymentPublicConfig {
  const config = record(value);
  const keys = config ? Object.keys(config) : [];
  const allowed = method === "mercado_pago" ? ["publicKey"] : [];
  if (
    !config ||
    keys.some((key) => !allowed.includes(key)) ||
    (config.publicKey !== undefined &&
      (typeof config.publicKey !== "string" ||
        !publicKeyPattern.test(config.publicKey)))
  ) {
    issues.push({
      code: "INVALID_FIELD",
      message: "La configuración pública no es válida.",
      path: "publicConfig"
    });
    return {};
  }
  return config.publicKey === undefined
    ? {}
    : { publicKey: config.publicKey as string };
}

export type PaymentMethodUpdate = {
  enabled: boolean;
  publicConfig: PaymentPublicConfig | null;
};

export function parsePaymentMethodUpdate(
  method: PaymentMethodKey,
  input: unknown
): PaymentParseResult<PaymentMethodUpdate> {
  const root = record(input);
  const issues: PaymentIssue[] = [];
  if (!root) {
    return {
      issues: [
        {
          code: "INVALID_STRUCTURE",
          message: "El pedido no tiene el formato esperado.",
          path: ""
        }
      ],
      ok: false
    };
  }
  for (const key of Object.keys(root)) {
    if (key !== "enabled" && key !== "publicConfig") {
      issues.push({
        code: "UNKNOWN_FIELD",
        message: "Ese campo no está permitido.",
        path: key
      });
    }
  }
  if (typeof root.enabled !== "boolean") {
    issues.push({
      code: "INVALID_FIELD",
      message: "Indicá si el medio queda habilitado.",
      path: "enabled"
    });
  }
  const publicConfig =
    root.publicConfig === undefined
      ? null
      : parsePublicConfig(root.publicConfig, method, issues);
  if (issues.length > 0) return { issues, ok: false };
  return {
    ok: true,
    value: { enabled: root.enabled as boolean, publicConfig }
  };
}

export function parsePaymentSecretRequest(
  method: PaymentMethodKey,
  input: unknown
): PaymentParseResult<{ secret: string }> {
  const root = record(input);
  const secret = root?.secret;
  if (
    !PROVIDER_PAYMENT_METHODS.includes(method) ||
    !root ||
    Object.keys(root).join() !== "secret" ||
    typeof secret !== "string" ||
    secret.length < PAYMENT_SECRET_LIMITS.min ||
    secret.length > PAYMENT_SECRET_LIMITS.max ||
    !/^[\x21-\x7e]+$/u.test(secret)
  ) {
    return {
      issues: [
        {
          code: "INVALID_FIELD",
          message: "La credencial no tiene un formato válido.",
          path: "secret"
        }
      ],
      ok: false
    };
  }
  return { ok: true, value: { secret } };
}

/** Validates the database view; any extra key (a leaked field) is rejected. */
export function parsePaymentMethodStatuses(
  input: unknown
): PaymentMethodStatus[] | null {
  if (!Array.isArray(input) || input.length !== PAYMENT_METHOD_KEYS.length) {
    return null;
  }
  const statuses: PaymentMethodStatus[] = [];
  for (const value of input) {
    const item = record(value);
    if (
      !item ||
      Object.keys(item).sort().join() !==
        "available,configured,enabled,method,publicConfig,updatedAt" ||
      !isPaymentMethodKey(item.method) ||
      typeof item.available !== "boolean" ||
      typeof item.configured !== "boolean" ||
      typeof item.enabled !== "boolean" ||
      typeof item.updatedAt !== "string"
    ) {
      return null;
    }
    const issues: PaymentIssue[] = [];
    const publicConfig = parsePublicConfig(
      item.publicConfig,
      item.method,
      issues
    );
    if (issues.length > 0) return null;
    statuses.push({
      available: item.available,
      configured: item.configured,
      enabled: item.enabled,
      method: item.method,
      publicConfig,
      updatedAt: item.updatedAt
    });
  }
  return statuses;
}
