/*
 * Sets the limits of the Realtime tenant of a self-hosted Supabase and prints them back.
 *
 *   pnpm exec tsx packages/infra/src/realtime-limits.ts [--users 2000] [--events 500] [--joins 500]
 *
 * Realtime re-seeds the tenant with its defaults (200 connections, 100 events and 100
 * joins per second) every time its container starts (SEED_SELF_HOST), so run this after a
 * restart. It talks to the tenant admin API of the container, signing the call with the
 * stack's JWT secret read from infra/supabase/.env; nothing secret is printed.
 */
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const tenant = "realtime-dev";
const container = "realtime-dev.supabase-realtime";

function arg(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? Number(process.argv[index + 1]) : fallback;
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`--${name} must be a positive integer`);
  }
  return value;
}

function jwtSecret(): string {
  const root = process.cwd();
  // In a worktree the ignored .env lives in the main checkout.
  const common = execFileSync("git", ["rev-parse", "--git-common-dir"], {
    cwd: root,
    encoding: "utf8"
  }).trim();
  const candidates = [
    path.join(root, "infra/supabase/.env"),
    path.join(path.dirname(path.resolve(root, common)), "infra/supabase/.env")
  ];
  const file = candidates.find((candidate) => existsSync(candidate)) ?? "";
  const line = readFileSync(file, "utf8")
    .split(/\r?\n/u)
    .find((entry) => entry.startsWith("JWT_SECRET="));
  const value = line?.slice("JWT_SECRET=".length).replace(/^["']|["']$/gu, "");
  if (!value) throw new Error("JWT_SECRET is not set in infra/supabase/.env");
  return value;
}

/** A minimal HS256 token: the tenant admin API only checks the signature and the role. */
function sign(secret: string): string {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
    exp: Math.floor(Date.now() / 1000) + 300,
    role: "service_role"
  })}`;
  const signature = createHmac("sha256", secret)
    .update(unsigned)
    .digest("base64url");
  return `${unsigned}.${signature}`;
}

async function main() {
  const limits = {
    max_concurrent_users: arg("users", 2000),
    max_events_per_second: arg("events", 500),
    max_joins_per_second: arg("joins", 500)
  };
  const token = sign(jwtSecret());
  // Inside the container, the admin API listens on 4000.
  const curl = (method: string, body?: string) =>
    execFileSync(
      "docker",
      [
        "exec",
        container,
        "curl",
        "-sS",
        "-X",
        method,
        "-H",
        `Authorization: Bearer ${token}`,
        "-H",
        "Content-Type: application/json",
        ...(body ? ["-d", body] : []),
        `http://localhost:4000/api/tenants/${tenant}`
      ],
      { encoding: "utf8" }
    );
  curl("PUT", JSON.stringify({ tenant: limits }));
  const current = JSON.parse(curl("GET")) as {
    data?: Record<string, unknown>;
  };
  const row = current.data ?? {};
  console.log(
    JSON.stringify(
      {
        max_concurrent_users: row.max_concurrent_users,
        max_events_per_second: row.max_events_per_second,
        max_joins_per_second: row.max_joins_per_second
      },
      null,
      2
    )
  );
}

void main();
