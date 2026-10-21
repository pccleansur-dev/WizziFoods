import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTenantDatabase } from "./tenant-repository.js";

const databaseUrl = process.env.DATABASE_URL;
const databaseAdminUrl = process.env.DATABASE_ADMIN_URL ?? databaseUrl;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("tenant repository with PostgreSQL RLS", () => {
  const userA = "10000000-0000-4000-8000-000000000001";
  const userB = "20000000-0000-4000-8000-000000000002";
  const tenantA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const tenantB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const sessionA = "70000000-0000-4000-8000-000000000007";
  const sessionB = "80000000-0000-4000-8000-000000000008";
  const admin = postgres(databaseAdminUrl ?? "", { prepare: false });
  const database = createTenantDatabase(databaseUrl ?? "");

  beforeAll(async () => {
    await admin.begin(async (transaction) => {
      await transaction`insert into auth.users (id) values (${userA}), (${userB})`;
      await transaction`
        insert into auth.sessions (id, user_id, aal, created_at, updated_at)
        values
          (${sessionA}, ${userA}, 'aal2', now(), now()),
          (${sessionB}, ${userB}, 'aal2', now(), now())
      `;
      await transaction`
        insert into public.tenants (id, slug, name)
        values
          (${tenantA}, 'repository-tenant-a', 'Repository Tenant A'),
          (${tenantB}, 'repository-tenant-b', 'Repository Tenant B')
      `;
      await transaction`
        insert into public.tenant_memberships (tenant_id, user_id, role)
        values (${tenantA}, ${userA}, 'admin'), (${tenantB}, ${userB}, 'admin')
      `;
      await transaction`
        insert into public.platform_superadmins (user_id) values (${userA})
      `;
    });
  });

  afterAll(async () => {
    await admin`delete from public.tenants where id in (${tenantA}, ${tenantB})`;
    await admin`delete from auth.users where id in (${userA}, ${userB})`;
    await database.close();
    await admin.end();
  });

  it("returns only the tenant derived from identity A", async () => {
    const contexts = await database.tenantRepository.findForIdentity(userA);

    expect(contexts).toHaveLength(1);
    expect(contexts[0]?.tenant).toMatchObject({
      id: tenantA,
      slug: "repository-tenant-a"
    });
    expect(contexts[0]?.location.name).toBe("Principal");
  });

  it("does not accept another tenant as request input", async () => {
    const contexts = await database.tenantRepository.findForIdentity(userB);

    expect(contexts.map(({ tenant }) => tenant.id)).toEqual([tenantB]);
  });

  it("resolves a platform superadmin without silently entering its tenant", async () => {
    await expect(
      database.identityAccessRepository.resolveForIdentity(userA, sessionA)
    ).resolves.toEqual({ type: "platform_superadmin" });
  });

  it("resolves a tenant administrator with only its own tenant", async () => {
    await expect(
      database.identityAccessRepository.resolveForIdentity(userB, sessionB)
    ).resolves.toMatchObject({
      tenantContexts: [
        { tenant: { id: tenantB, slug: "repository-tenant-b" } }
      ],
      type: "tenant_admin"
    });
  });

  it("does not resolve access after session revocation", async () => {
    await admin`delete from auth.sessions where id = ${sessionB}`;

    await expect(
      database.identityAccessRepository.resolveForIdentity(userB, sessionB)
    ).resolves.toBeNull();
  });
});
