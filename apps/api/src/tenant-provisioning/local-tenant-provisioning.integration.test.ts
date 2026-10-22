import { createClient } from "@supabase/supabase-js";
import { createTenantDatabase, type TenantDatabase } from "@platform/database";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTenantAdminInvitationGateway } from "./tenant-admin-invitation.gateway.js";
import { TenantProvisioningService } from "./tenant-provisioning.service.js";

const databaseUrl = process.env.DATABASE_URL;
const databaseAdminUrl = process.env.DATABASE_ADMIN_URL;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
const hasLocalStack =
  databaseUrl && databaseAdminUrl && supabaseUrl && supabaseSecretKey;
const describeWithLocalStack = hasLocalStack ? describe : describe.skip;

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
      "http://localhost:3000/auth/callback?next=/acceso/continuar"
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
      { locations: number; memberships: number; tenants: number }[]
    >`
      select
        (select count(*)::integer from public.tenants where slug = ${tenantSlug}) as tenants,
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
    expect(counts).toEqual({ locations: 1, memberships: 1, tenants: 1 });

    await expect(
      database.tenantProvisioningRepository.activateForIdentity(invitedUserId)
    ).resolves.toBe(true);
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
