import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTenantDatabase, type TenantDatabase } from "./index.js";

const databaseUrl = process.env.DATABASE_URL;
const databaseAdminUrl = process.env.DATABASE_ADMIN_URL ?? databaseUrl;
const describeWithLocalStack =
  databaseUrl && databaseAdminUrl ? describe : describe.skip;

describeWithLocalStack("staff authentication repository", () => {
  const tenantId = "d0000000-0000-4000-8000-00000000000d";
  const administratorId = "e0000000-0000-4000-8000-00000000000e";
  const waiterId = "f0000000-0000-4000-8000-00000000000f";
  const lockedWaiterId = "11000000-0000-4000-8000-000000000011";
  const managerId = "12000000-0000-4000-8000-000000000012";
  const validCredential = "scrypt-v1$fixture-valid";
  const lockedCredential = "scrypt-v1$fixture-lock";
  const managerCredential = "scrypt-v1$fixture-manager";
  const admin = postgres(databaseAdminUrl ?? "", { prepare: false });
  let database: TenantDatabase;

  beforeAll(async () => {
    await admin`delete from public.tenants where id = ${tenantId}`;
    await admin`delete from auth.users where id = ${administratorId}`;
    await admin`insert into auth.users (id) values (${administratorId})`;
    await admin`
      insert into public.tenants (id, slug, name, status)
      values (${tenantId}, 'staff-auth-test', 'Staff Auth Test', 'active')
    `;
    const [location] = await admin<{ id: string }[]>`
      select id
      from public.locations
      where tenant_id = ${tenantId}
        and is_primary
    `;
    if (!location) throw new Error("The tenant must have a primary location");

    await admin`
      insert into public.staff_members (
        id,
        tenant_id,
        location_id,
        username,
        display_name,
        role,
        created_by
      )
      values
        (
          ${waiterId},
          ${tenantId},
          ${location.id},
          'ana.moza',
          'Ana',
          'waiter',
          ${administratorId}
        ),
        (
          ${lockedWaiterId},
          ${tenantId},
          ${location.id},
          'juan.mozo',
          'Juan',
          'waiter',
          ${administratorId}
        ),
        (
          ${managerId},
          ${tenantId},
          ${location.id},
          'maria.encargada',
          'María',
          'manager',
          ${administratorId}
        )
    `;
    await admin`
      insert into private.staff_credentials (staff_member_id, pin_hash)
      values
        (${waiterId}, ${validCredential}),
        (${lockedWaiterId}, ${lockedCredential}),
        (${managerId}, ${managerCredential})
    `;
    database = createTenantDatabase(databaseUrl ?? "");
  });

  afterAll(async () => {
    await database?.close();
    await admin`delete from public.tenants where id = ${tenantId}`;
    await admin`delete from auth.users where id = ${administratorId}`;
    await admin.end();
  });

  it("creates a hashed, expiring session after a successful verification", async () => {
    const now = new Date("2026-10-21T18:00:00.000Z");
    const result = await database.staffAuthRepository.authenticate({
      expiresAt: new Date("2026-10-22T02:00:00.000Z"),
      now,
      tenantSlug: "staff-auth-test",
      tokenHash: "a".repeat(64),
      username: "ana.moza",
      verifyPin: async (stored) => stored === validCredential
    });

    expect(result).toMatchObject({
      identity: {
        staff: { displayName: "Ana", id: waiterId, role: "waiter" },
        tenant: { id: tenantId, slug: "staff-auth-test" }
      },
      result: "authenticated"
    });
    const [session] = await admin<{ expires_at: Date; token_hash: string }[]>`
      select token_hash, expires_at
      from private.staff_sessions
      where staff_member_id = ${waiterId}
    `;
    expect(session).toEqual({
      expires_at: new Date("2026-10-22T02:00:00.000Z"),
      token_hash: "a".repeat(64)
    });
  });

  it("resolves and revokes an active session with an audit trail", async () => {
    const now = new Date("2026-10-21T18:05:00.000Z");
    await expect(
      database.staffAuthRepository.resolveSession("a".repeat(64), now)
    ).resolves.toMatchObject({
      expiresAt: new Date("2026-10-22T02:00:00.000Z"),
      identity: { staff: { id: waiterId, role: "waiter" } }
    });
    await expect(
      database.staffAuthRepository.revokeSession("a".repeat(64), now)
    ).resolves.toBe(true);
    await expect(
      database.staffAuthRepository.resolveSession("a".repeat(64), now)
    ).resolves.toBeNull();

    const [audit] = await admin<{ count: number }[]>`
      select count(*)::integer as count
      from private.staff_auth_events
      where staff_member_id = ${waiterId}
        and event_type = 'session_revoked'
    `;
    expect(audit?.count).toBe(1);
  });

  it("expires a stale session and records that outcome once", async () => {
    await database.staffAuthRepository.authenticate({
      expiresAt: new Date("2026-10-21T19:00:00.000Z"),
      now: new Date("2026-10-21T18:00:00.000Z"),
      tenantSlug: "staff-auth-test",
      tokenHash: "f".repeat(64),
      username: "ana.moza",
      verifyPin: async (stored) => stored === validCredential
    });

    await expect(
      database.staffAuthRepository.resolveSession(
        "f".repeat(64),
        new Date("2026-10-21T20:00:00.000Z")
      )
    ).resolves.toBeNull();
    await expect(
      database.staffAuthRepository.resolveSession(
        "f".repeat(64),
        new Date("2026-10-21T20:01:00.000Z")
      )
    ).resolves.toBeNull();

    const [audit] = await admin<{ count: number }[]>`
      select count(*)::integer as count
      from private.staff_auth_events
      where staff_member_id = ${waiterId}
        and event_type = 'session_expired'
    `;
    expect(audit?.count).toBe(1);
  });

  it("revalidates a manager session and rejects revalidation for other roles", async () => {
    const signedInAt = new Date("2026-10-21T18:00:00.000Z");
    await database.staffAuthRepository.authenticate({
      expiresAt: new Date("2026-10-22T02:00:00.000Z"),
      now: signedInAt,
      tenantSlug: "staff-auth-test",
      tokenHash: "d".repeat(64),
      username: "maria.encargada",
      verifyPin: async (stored) => stored === managerCredential
    });
    await database.staffAuthRepository.authenticate({
      expiresAt: new Date("2026-10-22T02:00:00.000Z"),
      now: signedInAt,
      tenantSlug: "staff-auth-test",
      tokenHash: "e".repeat(64),
      username: "ana.moza",
      verifyPin: async (stored) => stored === validCredential
    });
    const revalidatedAt = new Date("2026-10-21T18:20:00.000Z");

    await expect(
      database.staffAuthRepository.revalidate({
        now: revalidatedAt,
        tokenHash: "d".repeat(64),
        verifyPin: async (stored) => stored === managerCredential
      })
    ).resolves.toEqual({ revalidatedAt, result: "revalidated" });
    await expect(
      database.staffAuthRepository.revalidate({
        now: revalidatedAt,
        tokenHash: "e".repeat(64),
        verifyPin: async (stored) => stored === validCredential
      })
    ).resolves.toEqual({ result: "unauthorized" });

    const [managerSession] = await admin<{ last_revalidated_at: Date }[]>`
      select last_revalidated_at
      from private.staff_sessions
      where token_hash = ${"d".repeat(64)}
    `;
    expect(managerSession?.last_revalidated_at).toEqual(revalidatedAt);
  });

  it("locks the account atomically after five invalid attempts", async () => {
    const base = {
      expiresAt: new Date("2026-10-22T02:00:00.000Z"),
      now: new Date("2026-10-21T18:00:00.000Z"),
      tenantSlug: "staff-auth-test",
      tokenHash: "b".repeat(64),
      username: "juan.mozo"
    };

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expect(
        database.staffAuthRepository.authenticate({
          ...base,
          verifyPin: async () => false
        })
      ).resolves.toEqual({ result: "invalid" });
    }
    await expect(
      database.staffAuthRepository.authenticate({
        ...base,
        verifyPin: async () => false
      })
    ).resolves.toEqual({ result: "locked" });
    await expect(
      database.staffAuthRepository.authenticate({
        ...base,
        verifyPin: async (stored) => stored === lockedCredential
      })
    ).resolves.toEqual({ result: "locked" });

    const [credential] = await admin<
      { failed_attempts: number; locked_until: Date }[]
    >`
      select failed_attempts, locked_until
      from private.staff_credentials
      where staff_member_id = ${lockedWaiterId}
    `;
    expect(credential).toEqual({
      failed_attempts: 5,
      locked_until: new Date("2026-10-21T18:15:00.000Z")
    });
  });

  it("performs the verifier work and audits an unknown username", async () => {
    let verifiedValue: string | null | undefined;
    await expect(
      database.staffAuthRepository.authenticate({
        expiresAt: new Date("2026-10-22T02:00:00.000Z"),
        now: new Date("2026-10-21T18:00:00.000Z"),
        tenantSlug: "staff-auth-test",
        tokenHash: "c".repeat(64),
        username: "desconocido",
        verifyPin: async (stored) => {
          verifiedValue = stored;
          return false;
        }
      })
    ).resolves.toEqual({ result: "invalid" });
    expect(verifiedValue).toBeNull();

    const [audit] = await admin<{ count: number }[]>`
      select count(*)::integer as count
      from private.staff_auth_events
      where tenant_id = ${tenantId}
        and staff_member_id is null
        and event_type = 'login_failed'
    `;
    expect(audit?.count).toBe(1);
  });
});
