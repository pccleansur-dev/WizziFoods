import { describe, expect, it } from "vitest";

import { createSupabaseEnvironment } from "./supabase-env.js";

const template = `POSTGRES_PASSWORD=placeholder
JWT_SECRET=placeholder
ANON_KEY=placeholder
SERVICE_ROLE_KEY=placeholder
SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
JWT_KEYS=
JWT_JWKS=
ANON_KEY_ASYMMETRIC=
SERVICE_ROLE_KEY_ASYMMETRIC=
DASHBOARD_PASSWORD=placeholder
SECRET_KEY_BASE=placeholder
REALTIME_DB_ENC_KEY=placeholder
VAULT_ENC_KEY=placeholder
PG_META_CRYPTO_KEY=placeholder
LOGFLARE_PUBLIC_ACCESS_TOKEN=placeholder
LOGFLARE_PRIVATE_ACCESS_TOKEN=placeholder
S3_PROTOCOL_ACCESS_KEY_ID=placeholder
S3_PROTOCOL_ACCESS_KEY_SECRET=placeholder
MINIO_ROOT_PASSWORD=placeholder
POOLER_TENANT_ID=placeholder
OPENAI_API_KEY=placeholder
DISABLE_SIGNUP=false
ENABLE_EMAIL_SIGNUP=true
ENABLE_PHONE_SIGNUP=true
FUNCTIONS_VERIFY_JWT=false
`;

function readValue(environment: string, key: string): string {
  const line = environment
    .split("\n")
    .find((candidate) => candidate.startsWith(`${key}=`));

  if (!line) {
    throw new Error(`Missing ${key}`);
  }

  return line.slice(key.length + 1);
}

describe("createSupabaseEnvironment", () => {
  it("replaces placeholders with usable isolated secrets", () => {
    const environment = createSupabaseEnvironment(template, 1_800_000_000_000);

    expect(environment).not.toContain("=placeholder");
    expect(readValue(environment, "POSTGRES_PASSWORD")).toMatch(
      /^[a-f0-9]{32}$/
    );
    expect(readValue(environment, "REALTIME_DB_ENC_KEY")).toMatch(
      /^[a-f0-9]{16}$/
    );
    expect(readValue(environment, "SUPABASE_PUBLISHABLE_KEY")).toMatch(
      /^sb_publishable_/
    );
    expect(readValue(environment, "SUPABASE_SECRET_KEY")).toMatch(
      /^sb_secret_/
    );
  });

  it("generates role-specific legacy JWTs", () => {
    const environment = createSupabaseEnvironment(template, 1_800_000_000_000);
    const anonPayload = JSON.parse(
      Buffer.from(
        readValue(environment, "ANON_KEY").split(".")[1]!,
        "base64url"
      ).toString()
    ) as { role: string };
    const servicePayload = JSON.parse(
      Buffer.from(
        readValue(environment, "SERVICE_ROLE_KEY").split(".")[1]!,
        "base64url"
      ).toString()
    ) as { role: string };

    expect(anonPayload.role).toBe("anon");
    expect(servicePayload.role).toBe("service_role");
  });

  it("uses secure defaults before authentication flows are implemented", () => {
    const environment = createSupabaseEnvironment(template, 1_800_000_000_000);

    expect(readValue(environment, "DISABLE_SIGNUP")).toBe("true");
    expect(readValue(environment, "ENABLE_EMAIL_SIGNUP")).toBe("false");
    expect(readValue(environment, "ENABLE_PHONE_SIGNUP")).toBe("false");
    expect(readValue(environment, "FUNCTIONS_VERIFY_JWT")).toBe("true");
    expect(readValue(environment, "OPENAI_API_KEY")).toBe("");
  });
});
