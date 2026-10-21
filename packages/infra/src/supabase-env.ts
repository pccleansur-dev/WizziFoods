import {
  createHash,
  createHmac,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign
} from "node:crypto";

type JsonWebKeyParts = {
  crv?: string;
  d?: string;
  x?: string;
  y?: string;
};

function encodeJson(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function createLegacyJwt(
  role: "anon" | "service_role",
  secret: string,
  issuedAt: number
): string {
  const header = encodeJson({ alg: "HS256", typ: "JWT" });
  const payload = encodeJson({
    role,
    iss: "supabase",
    iat: issuedAt,
    exp: issuedAt + 5 * 365 * 24 * 60 * 60
  });
  const content = `${header}.${payload}`;
  const signature = createHmac("sha256", secret)
    .update(content)
    .digest("base64url");

  return `${content}.${signature}`;
}

function createOpaqueKey(prefix: "sb_publishable_" | "sb_secret_"): string {
  const random = randomBytes(17).toString("base64url").slice(0, 22);
  const intermediate = `${prefix}${random}`;
  const checksum = createHash("sha256")
    .update(`supabase-self-hosted|${intermediate}`)
    .digest("base64url")
    .slice(0, 8);

  return `${intermediate}_${checksum}`;
}

function requireEcParts(jwk: JsonWebKeyParts): Required<JsonWebKeyParts> {
  if (!jwk.crv || !jwk.d || !jwk.x || !jwk.y) {
    throw new Error("Node.js did not export a complete P-256 key");
  }

  return { crv: jwk.crv, d: jwk.d, x: jwk.x, y: jwk.y };
}

function replaceValue(template: string, key: string, value: string): string {
  const pattern = new RegExp(`^${key}=.*$`, "m");

  if (!pattern.test(template)) {
    throw new Error(`Supabase template is missing ${key}`);
  }

  return template.replace(pattern, `${key}=${value}`);
}

export function createSupabaseEnvironment(
  template: string,
  now = Date.now()
): string {
  const issuedAt = Math.floor(now / 1000);
  const jwtSecret = randomBytes(30).toString("base64");
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = requireEcParts(
    privateKey.export({ format: "jwk" }) as JsonWebKeyParts
  );
  const kid = randomUUID();
  const symmetricJwk = {
    alg: "HS256",
    k: Buffer.from(jwtSecret).toString("base64url"),
    kty: "oct"
  };
  const privateJwk = {
    alg: "ES256",
    crv: jwk.crv,
    d: jwk.d,
    ext: true,
    key_ops: ["sign", "verify"],
    kid,
    kty: "EC",
    use: "sig",
    x: jwk.x,
    y: jwk.y
  };
  const publicJwk = {
    alg: "ES256",
    crv: jwk.crv,
    ext: true,
    key_ops: ["verify"],
    kid,
    kty: "EC",
    use: "sig",
    x: jwk.x,
    y: jwk.y
  };

  function createAsymmetricJwt(role: "anon" | "service_role"): string {
    const header = encodeJson({ alg: "ES256", typ: "JWT", kid });
    const payload = encodeJson({
      role,
      iss: "supabase",
      iat: issuedAt,
      exp: issuedAt + 5 * 365 * 24 * 60 * 60
    });
    const content = `${header}.${payload}`;
    const signature = sign("SHA256", Buffer.from(content), {
      dsaEncoding: "ieee-p1363",
      key: privateKey
    }).toString("base64url");

    return `${content}.${signature}`;
  }

  const replacements: Record<string, string> = {
    ANON_KEY: createLegacyJwt("anon", jwtSecret, issuedAt),
    ANON_KEY_ASYMMETRIC: createAsymmetricJwt("anon"),
    AUTH_AUDIT_LOG_DISABLE_POSTGRES: "false",
    DASHBOARD_PASSWORD: `a${randomBytes(16).toString("hex")}`,
    DISABLE_SIGNUP: "true",
    ENABLE_EMAIL_SIGNUP: "false",
    ENABLE_PHONE_SIGNUP: "false",
    FUNCTIONS_VERIFY_JWT: "true",
    GOOGLE_CLIENT_ID: "",
    GOOGLE_ENABLED: "false",
    GOOGLE_SECRET: "",
    JWT_JWKS: JSON.stringify({ keys: [publicJwk, symmetricJwk] }),
    JWT_KEYS: JSON.stringify([privateJwk, symmetricJwk]),
    JWT_SECRET: jwtSecret,
    LOGFLARE_PRIVATE_ACCESS_TOKEN: randomBytes(24).toString("base64"),
    LOGFLARE_PUBLIC_ACCESS_TOKEN: randomBytes(24).toString("base64"),
    MINIO_ROOT_PASSWORD: randomBytes(16).toString("hex"),
    MFA_MAX_ENROLLED_FACTORS: "3",
    MFA_TOTP_ENROLL_ENABLED: "true",
    MFA_TOTP_VERIFY_ENABLED: "true",
    OPENAI_API_KEY: "",
    PG_META_CRYPTO_KEY: randomBytes(24).toString("base64"),
    POOLER_TENANT_ID: randomBytes(8).toString("hex"),
    POSTGRES_PASSWORD: randomBytes(16).toString("hex"),
    REALTIME_DB_ENC_KEY: randomBytes(8).toString("hex"),
    S3_PROTOCOL_ACCESS_KEY_ID: randomBytes(16).toString("hex"),
    S3_PROTOCOL_ACCESS_KEY_SECRET: randomBytes(32).toString("hex"),
    SECRET_KEY_BASE: randomBytes(48).toString("base64"),
    SERVICE_ROLE_KEY: createLegacyJwt("service_role", jwtSecret, issuedAt),
    SERVICE_ROLE_KEY_ASYMMETRIC: createAsymmetricJwt("service_role"),
    SUPABASE_PUBLISHABLE_KEY: createOpaqueKey("sb_publishable_"),
    SUPABASE_SECRET_KEY: createOpaqueKey("sb_secret_"),
    VAULT_ENC_KEY: randomBytes(16).toString("hex")
  };

  return Object.entries(replacements).reduce(
    (environment, [key, value]) => replaceValue(environment, key, value),
    template
  );
}
