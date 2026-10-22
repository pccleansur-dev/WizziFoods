import { createHmac, randomBytes } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { createTenantDatabase, type TenantDatabase } from "@platform/database";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTenantAdminInvitationGateway } from "./tenant-admin-invitation.gateway.js";
import { TenantProvisioningService } from "./tenant-provisioning.service.js";
import { TenantContextService } from "../tenants/tenant-context.service.js";

const databaseUrl = process.env.DATABASE_URL;
const databaseAdminUrl = process.env.DATABASE_ADMIN_URL;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const localMailUrl = process.env.LOCAL_MAIL_URL;
const hasLocalStack =
  databaseUrl &&
  databaseAdminUrl &&
  supabaseUrl &&
  supabaseSecretKey &&
  supabasePublishableKey &&
  localMailUrl;
const describeWithLocalStack = hasLocalStack ? describe : describe.skip;

function decodeBase32(value: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const character of value.replaceAll("=", "").toUpperCase()) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("Invalid TOTP secret");
    bits += index.toString(2).padStart(5, "0");
  }

  const bytes: number[] = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  }
  return Buffer.from(bytes);
}

function createTotp(secret: string, now = Date.now()): string {
  const counter = BigInt(Math.floor(now / 30_000));
  const payload = Buffer.alloc(8);
  payload.writeBigUInt64BE(counter);
  const digest = createHmac("sha1", decodeBase32(secret))
    .update(payload)
    .digest();
  const offset = digest.at(-1)! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);
  return (binary % 1_000_000).toString().padStart(6, "0");
}

describeWithLocalStack("tenant provisioning with local Supabase", () => {
  const superadminUserId = "78000000-0000-4000-8000-000000000078";
  const superadminSessionId = "79000000-0000-4000-8000-000000000079";
  const adminEmail = "t07-owner@example.test";
  const tenantSlug = "t07-local-business";
  const admin = postgres(databaseAdminUrl ?? "", { prepare: false });
  const supabase = createClient(
    supabaseUrl ?? "https://unused.invalid",
    supabaseSecretKey ?? "sb_secret_unused",
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false
      }
    }
  );
  let database: TenantDatabase;
  let invitedUserId: string | undefined;

  beforeAll(async () => {
    await fetch(`${localMailUrl}/api/v1/mailbox/t07-owner`, {
      method: "DELETE"
    });
    const existingUsers = await supabase.auth.admin.listUsers({
      page: 1,
      perPage: 1000
    });
    const existingInvite = existingUsers.data.users.find(
      (user) => user.email === adminEmail
    );
    if (existingInvite) {
      await supabase.auth.admin.deleteUser(existingInvite.id);
    }
    await admin`delete from public.tenants where slug = ${tenantSlug}`;
    await admin`delete from auth.users where id = ${superadminUserId}`;
    await admin`insert into auth.users (id) values (${superadminUserId})`;
    await admin`
      insert into auth.sessions (id, user_id, aal, created_at, updated_at)
      values (
        ${superadminSessionId},
        ${superadminUserId},
        'aal2',
        now(),
        now()
      )
    `;
    await admin`
      insert into public.platform_superadmins (user_id)
      values (${superadminUserId})
    `;
    database = createTenantDatabase(databaseUrl ?? "");
  });

  afterAll(async () => {
    await database?.close();
    await admin`delete from public.tenants where slug = ${tenantSlug}`;
    if (invitedUserId) await supabase.auth.admin.deleteUser(invitedUserId);
    await admin`delete from auth.users where id = ${superadminUserId}`;
    await admin.end();
  });

  it("creates, invites, retries and activates without duplicating the tenant", async () => {
    const service = new TenantProvisioningService(
      database.identityAccessRepository,
      database.tenantProvisioningRepository,
      createTenantAdminInvitationGateway(
        supabaseUrl ?? "",
        supabaseSecretKey ?? ""
      ),
      "http://localhost:3000/auth/callback?next=/acceso/continuar",
      "plataforma.test"
    );
    const identity = {
      assuranceLevel: "aal2" as const,
      sessionId: superadminSessionId,
      userId: superadminUserId
    };
    const request = {
      adminEmail,
      name: "T07 Local Business",
      slug: tenantSlug
    };

    const created = await service.create(
      identity,
      "t07-local-request",
      request
    );
    const retried = await service.create(
      identity,
      "t07-local-request",
      request
    );

    expect(created).toEqual(retried);
    expect(created).toMatchObject({
      adminEmail,
      domain: { hostname: `${tenantSlug}.plataforma.test` },
      status: "invited",
      tenant: { name: request.name, slug: tenantSlug }
    });
    expect(Object.keys(created)).not.toContain("authUserId");

    const [provisioning] = await admin<
      { auth_user_id: string; status: string; tenant_id: string }[]
    >`
      select auth_user_id, status, tenant_id
      from private.tenant_provisioning_requests
      where admin_email = ${adminEmail}
    `;
    if (!provisioning) throw new Error("The invitation must be persisted");
    invitedUserId = provisioning.auth_user_id;

    const [counts] = await admin<
      {
        domains: number;
        locations: number;
        memberships: number;
        tenants: number;
      }[]
    >`
      select
        (select count(*)::integer from public.tenants where slug = ${tenantSlug}) as tenants,
        (
          select count(*)::integer from public.tenant_domains
          where tenant_id = ${provisioning.tenant_id}
            and hostname = ${`${tenantSlug}.plataforma.test`}
        ) as domains,
        (
          select count(*)::integer from public.locations
          where tenant_id = ${provisioning.tenant_id}
        ) as locations,
        (
          select count(*)::integer from public.tenant_memberships
          where tenant_id = ${provisioning.tenant_id}
            and user_id = ${invitedUserId}
        ) as memberships
    `;
    expect(counts).toEqual({
      domains: 1,
      locations: 1,
      memberships: 1,
      tenants: 1
    });

    const messageResponse = await fetch(
      `${localMailUrl}/api/v1/mailbox/t07-owner/latest`,
      { headers: { accept: "application/json" } }
    );
    expect(messageResponse.ok).toBe(true);
    const message = (await messageResponse.json()) as {
      body?: { html?: string; text?: string };
    };
    const messageBody = message.body?.html ?? message.body?.text ?? "";
    const invitationLink = messageBody
      .match(/https?:\/\/[^\s"'<>]+/gu)
      ?.map((candidate) => candidate.replaceAll("&amp;", "&"))
      .find((candidate) => candidate.includes("/auth/v1/verify"));
    if (!invitationLink)
      throw new Error("The invite email must contain a link");
    const invitationUrl = new URL(invitationLink);
    const tokenHash = invitationUrl.searchParams.get("token");
    if (!tokenHash) throw new Error("The invite link must contain a token");

    const invitedClient = createClient(
      supabaseUrl ?? "https://unused.invalid",
      supabasePublishableKey ?? "sb_publishable_unused",
      {
        auth: {
          autoRefreshToken: false,
          detectSessionInUrl: false,
          persistSession: false
        }
      }
    );
    const verification = await invitedClient.auth.verifyOtp({
      token_hash: tokenHash,
      type: "invite"
    });
    expect(verification.error).toBeNull();
    expect(verification.data.user?.id).toBe(invitedUserId);
    const passwordUpdate = await invitedClient.auth.updateUser({
      password: `${randomBytes(24).toString("base64url")}A1!`
    });
    expect(passwordUpdate.error).toBeNull();

    const enrollment = await invitedClient.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "T07 integration"
    });
    expect(enrollment.error).toBeNull();
    if (enrollment.error) throw enrollment.error;
    const challenge = await invitedClient.auth.mfa.challenge({
      factorId: enrollment.data.id
    });
    expect(challenge.error).toBeNull();
    if (challenge.error) throw challenge.error;
    const mfaVerification = await invitedClient.auth.mfa.verify({
      challengeId: challenge.data.id,
      code: createTotp(enrollment.data.totp.secret),
      factorId: enrollment.data.id
    });
    expect(mfaVerification.error).toBeNull();

    const claims = await invitedClient.auth.getClaims();
    expect(claims.error).toBeNull();
    const userId = claims.data?.claims.sub;
    const sessionId = claims.data?.claims.session_id;
    expect(claims.data?.claims.aal).toBe("aal2");
    if (typeof userId !== "string" || typeof sessionId !== "string") {
      throw new Error("The invited administrator must have an active session");
    }
    const accessService = new TenantContextService(
      database.identityAccessRepository,
      database.tenantProvisioningRepository
    );
    await expect(
      accessService.getForAuthenticatedIdentity(userId, sessionId)
    ).resolves.toMatchObject({
      tenantContexts: [{ tenant: { slug: tenantSlug } }],
      type: "tenant_admin"
    });
    await expect(
      database.tenantProvisioningRepository.activateForIdentity(invitedUserId)
    ).resolves.toBe(true);
    const [activated] = await admin<{ status: string }[]>`
      select status
      from private.tenant_provisioning_requests
      where auth_user_id = ${invitedUserId}
    `;
    expect(activated?.status).toBe("activated");
  });
});
