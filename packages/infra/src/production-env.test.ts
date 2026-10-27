import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createProductionEnvironment } from "./production-env.js";

const root = path.resolve(import.meta.dirname, "../../..");
const template = readFileSync(
  path.join(root, "infra/supabase/.env.example"),
  "utf8"
);
const options = {
  api: "api",
  app: "app",
  domain: "midominio.com",
  supabase: "supabase"
};

function parse(text: string): Record<string, string> {
  return Object.fromEntries(
    text
      .split("\n")
      .filter((line) => /^[A-Z0-9_]+=/u.test(line))
      .map((line) => [
        line.slice(0, line.indexOf("=")),
        line.slice(line.indexOf("=") + 1)
      ])
  );
}

describe("production environment", () => {
  const env = parse(createProductionEnvironment(template, options));

  it("derives every public address from the domain, over https", () => {
    expect(env.NEXT_PUBLIC_APP_URL).toBe("https://app.midominio.com");
    expect(env.NEXT_PUBLIC_API_URL).toBe("https://api.midominio.com");
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe("https://supabase.midominio.com");
    expect(env.SUPABASE_PUBLIC_URL).toBe("https://supabase.midominio.com");
    expect(env.API_EXTERNAL_URL).toBe("https://supabase.midominio.com/auth/v1");
    expect(env.SITE_URL).toBe("https://app.midominio.com");
    expect(env.PLATFORM_BASE_DOMAIN).toBe("midominio.com");
  });

  it("with a suffix, names everything one level under the domain", () => {
    const flat = parse(
      createProductionEnvironment(template, {
        ...options,
        domain: "wizzi.com.ar",
        suffix: "carta"
      })
    );
    expect(flat.NEXT_PUBLIC_APP_URL).toBe("https://app-carta.wizzi.com.ar");
    expect(flat.NEXT_PUBLIC_API_URL).toBe("https://api-carta.wizzi.com.ar");
    expect(flat.NEXT_PUBLIC_SUPABASE_URL).toBe(
      "https://supabase-carta.wizzi.com.ar"
    );
    expect(flat.PLATFORM_BASE_DOMAIN).toBe("wizzi.com.ar");
    expect(flat.PLATFORM_TENANT_HOST_TEMPLATE).toBe("{slug}-carta.{domain}");
    expect(env.PLATFORM_TENANT_HOST_TEMPLATE).toBe("{slug}.{domain}");
  });

  it("keeps nothing of the local machine", () => {
    const text = Object.values(env).join("\n");
    expect(text).not.toContain("localhost");
    expect(text).not.toContain("replace-with");
    expect(env.DISABLE_SIGNUP).toBe("true");
    expect(env.MERCADO_PAGO_MODE).toBe("off");
    expect(env.WHATSAPP_MODE).toBe("off");
    expect(env.WEB_PUSH_MODE).toBe("off");
  });

  it("generates different secrets every time and long enough ones", () => {
    const other = parse(createProductionEnvironment(template, options));
    for (const key of [
      "POSTGRES_PASSWORD",
      "JWT_SECRET",
      "SUPABASE_SECRET_KEY",
      "STAFF_PIN_PEPPER",
      "PAYMENT_SECRET_KEY",
      "SECRET_KEY_BASE"
    ]) {
      expect(env[key]!.length).toBeGreaterThanOrEqual(20);
      expect(other[key]).not.toBe(env[key]);
    }
    expect(env.SUPABASE_SECRET_KEY).toMatch(/^sb_secret_/u);
    expect(env.SUPABASE_PUBLISHABLE_KEY).toMatch(/^sb_publishable_/u);
  });

  it("covers every variable the production compose requires without a default", () => {
    const compose = readFileSync(
      path.join(root, "infra/deploy/docker-compose.yml"),
      "utf8"
    );
    const needed = new Set<string>();
    for (const match of compose.matchAll(/\$\{([A-Z0-9_]+)(:\?[^}]*|)\}/gu)) {
      needed.add(match[1]!);
    }
    // Variables of the pinned Supabase services this stack extends (comments excluded).
    const supabase = readFileSync(
      path.join(root, "infra/supabase/docker-compose.yml"),
      "utf8"
    );
    const blocks = supabase.split(/\n(?= {2}[a-z][a-z-]*:\n)/u);
    for (const service of [
      "db",
      "auth",
      "rest",
      "realtime",
      "storage",
      "imgproxy",
      "api-gw"
    ]) {
      const block = blocks.find((candidate) =>
        candidate.trimStart().startsWith(`${service}:`)
      );
      expect(block, `service ${service} in the Supabase file`).toBeDefined();
      const code = block!
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("#"))
        .join("\n");
      for (const match of code.matchAll(/\$\{([A-Z0-9_]+)\}/gu)) {
        needed.add(match[1]!);
      }
    }
    // Studio, Meta, Functions and the pooler are not part of the production stack.
    const notDeployed = new Set([
      "DOCKER_SOCKET_LOCATION",
      "FUNCTIONS_VERIFY_JWT",
      "LOGFLARE_PRIVATE_ACCESS_TOKEN",
      "LOGFLARE_PUBLIC_ACCESS_TOKEN",
      "OPENAI_API_KEY",
      "PG_META_CRYPTO_KEY",
      "POOLER_DB_POOL_SIZE",
      "POOLER_DEFAULT_POOL_SIZE",
      "POOLER_MAX_CLIENT_CONN",
      "POOLER_PROXY_PORT_TRANSACTION",
      "POOLER_TENANT_ID",
      "POSTGRES_HOST_PORT",
      "STUDIO_DEFAULT_ORGANIZATION",
      "STUDIO_DEFAULT_PROJECT",
      "VAULT_ENC_KEY",
      "GOOGLE_PROJECT_ID",
      "GOOGLE_PROJECT_NUMBER",
      "MINIO_ROOT_PASSWORD",
      "MINIO_ROOT_USER",
      "API_GW_HTTP_PORT",
      "KONG_HTTP_PORT",
      "KONG_HTTPS_PORT"
    ]);
    // Optional ones carry a default (`:-`) in the compose; the regexp above only sees the
    // plain and `:?` forms, so what is left must exist.
    const missing = [...needed].filter(
      (name) => !notDeployed.has(name) && !(name in env)
    );
    expect(missing).toEqual([]);
  });

  it("rejects what is not a domain or a host label", () => {
    expect(() =>
      createProductionEnvironment(template, { ...options, domain: "nodomain" })
    ).toThrow(/domain/u);
    expect(() =>
      createProductionEnvironment(template, { ...options, app: "a b" })
    ).toThrow(/host label/u);
  });

  it("mounts nothing from the repository: Coolify turns such mounts into empty folders", () => {
    const compose = readFileSync(
      path.join(root, "infra/deploy/docker-compose.yml"),
      "utf8"
    );
    const code = compose
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("#"))
      .join("\n");
    expect(code).not.toMatch(/^\s*-\s*\.{1,2}\//mu);
    expect(code).not.toMatch(/^\s*-\s*\/[^:]+:/mu);
    expect(code).not.toContain("!reset");
    expect(code).not.toContain("!override");
  });
});
