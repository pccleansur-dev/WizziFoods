import { createHmac, randomBytes, randomUUID } from "node:crypto";

import postgres from "postgres";

import { ownerDatabaseUrl, stackEnv } from "./stack-env";

export const panelSlug = "e2e-panel";
export const panelHostname = "e2e-panel.localhost";
const email = "e2e-panel-admin@example.test";

export type PanelBusiness = {
  close(): Promise<void>;
  email: string;
  password: string;
  /** The six digits valid right now for the administrator's authenticator. */
  code(): string;
};

function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of input.replace(/=+$/u, "")) {
    bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}

function totp(secret: string, at = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const hash = createHmac("sha1", base32Decode(secret))
    .update(counter)
    .digest();
  const offset = (hash[hash.length - 1] ?? 0) & 15;
  const code =
    (((hash[offset] ?? 0) & 127) << 24) |
    (((hash[offset + 1] ?? 0) & 255) << 16) |
    (((hash[offset + 2] ?? 0) & 255) << 8) |
    ((hash[offset + 3] ?? 0) & 255);
  return String(code % 1_000_000).padStart(6, "0");
}

async function auth(
  base: string,
  route: string,
  init: { body?: unknown; headers: Record<string, string> }
): Promise<{ body: Record<string, unknown>; status: number }> {
  const response = await fetch(`${base}${route}`, {
    body: JSON.stringify(init.body ?? {}),
    headers: { "content-type": "application/json", ...init.headers },
    method: "POST"
  });
  const text = await response.text();
  return {
    body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
    status: response.status
  };
}

/**
 * A business with an administrator who has a password and an authenticator enrolled, as
 * the panel requires (aal2). The journeys sign in through the real forms.
 */
export async function seedPanelBusiness(): Promise<PanelBusiness> {
  const env = stackEnv();
  const base = env.SUPABASE_URL!;
  const secretKey = env.SUPABASE_SECRET_KEY!;
  const publishableKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
  const owner = postgres(ownerDatabaseUrl(), { prepare: false });

  async function wipe() {
    await owner`
      delete from private.audit_events
      where tenant_id in (select id from public.tenants where slug = ${panelSlug})`;
    await owner`delete from public.tenants where slug = ${panelSlug}`;
    await owner`delete from auth.users where email = ${email}`;
  }
  await wipe();

  const password = `E2e-${randomBytes(8).toString("hex")}`;
  const created = await auth(base, "/auth/v1/admin/users", {
    body: { email, email_confirm: true, password },
    headers: { apikey: secretKey, authorization: `Bearer ${secretKey}` }
  });
  if (created.status >= 300) throw new Error("could not create the admin user");
  const userId = String(created.body.id);
  const signedIn = await auth(base, "/auth/v1/token?grant_type=password", {
    body: { email, password },
    headers: { apikey: publishableKey }
  });
  const bearer = {
    apikey: publishableKey,
    authorization: `Bearer ${String(signedIn.body.access_token)}`
  };
  const factor = await auth(base, "/auth/v1/factors", {
    body: { factor_type: "totp", friendly_name: "e2e", issuer: "E2E" },
    headers: bearer
  });
  const secret = String((factor.body.totp as { secret: string }).secret);
  const challenge = await auth(
    base,
    `/auth/v1/factors/${String(factor.body.id)}/challenge`,
    { headers: bearer }
  );
  const verified = await auth(
    base,
    `/auth/v1/factors/${String(factor.body.id)}/verify`,
    {
      body: { challenge_id: challenge.body.id, code: totp(secret) },
      headers: bearer
    }
  );
  if (verified.status >= 300)
    throw new Error("could not enrol the authenticator");

  const tenantId = randomUUID();
  await owner`
    insert into public.tenants (id, slug, name, status)
    values (${tenantId}, ${panelSlug}, 'Negocio E2E de panel', 'active')`;
  await owner`
    insert into public.tenant_memberships (tenant_id, user_id, role)
    values (${tenantId}, ${userId}, 'admin')`;
  await owner`
    insert into public.tenant_domains (tenant_id, hostname, kind, status, is_primary)
    values (${tenantId}, ${panelHostname}, 'platform_subdomain', 'active', true)`;

  return {
    async close() {
      await wipe();
      await owner.end();
    },
    code: () => totp(secret),
    email,
    password
  };
}
