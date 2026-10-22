import {
  evaluatePinAttempt,
  type StaffIdentity,
  type StaffRole
} from "@platform/contracts";
import type postgres from "postgres";

export type StaffAuthenticationResult =
  | { identity: StaffIdentity; result: "authenticated" }
  | {
      result: "inactive" | "invalid" | "locked" | "tenant_not_found";
    };

export type StaffAuthenticationInput = {
  expiresAt: Date;
  now: Date;
  tenantSlug: string;
  tokenHash: string;
  username: string;
  verifyPin(storedCredential: string | null): Promise<boolean>;
};

export type StaffSessionRecord = {
  expiresAt: Date;
  identity: StaffIdentity;
  lastRevalidatedAt: Date;
};

export type StaffRevalidationResult =
  | { revalidatedAt: Date; result: "revalidated" }
  | { result: "invalid" | "locked" | "unauthorized" };

export type StaffRevalidationInput = {
  now: Date;
  tokenHash: string;
  verifyPin(storedCredential: string | null): Promise<boolean>;
};

export interface StaffAuthRepository {
  authenticate(
    input: StaffAuthenticationInput
  ): Promise<StaffAuthenticationResult>;
  resolveSession(
    tokenHash: string,
    now: Date
  ): Promise<StaffSessionRecord | null>;
  revalidate(input: StaffRevalidationInput): Promise<StaffRevalidationResult>;
  revokeSession(tokenHash: string, now: Date): Promise<boolean>;
}

type StaffCandidateRow = {
  display_name: string;
  failed_attempts: number;
  is_active: boolean;
  location_id: string;
  location_name: string;
  locked_until: Date | string | null;
  pin_hash: string;
  role: StaffRole;
  staff_member_id: string;
};

type TenantRow = {
  id: string;
  name: string;
  slug: string;
};

type StaffSessionRow = {
  display_name: string;
  expires_at: Date | string;
  is_active: boolean;
  last_revalidated_at: Date | string;
  location_id: string;
  location_name: string;
  revoked_at: Date | string | null;
  role: StaffRole;
  session_id: string;
  staff_member_id: string;
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  tenant_status: string;
};

type RevalidationCandidateRow = {
  expires_at: Date | string;
  failed_attempts: number;
  is_active: boolean;
  locked_until: Date | string | null;
  pin_hash: string;
  revoked_at: Date | string | null;
  role: StaffRole;
  session_id: string;
  staff_member_id: string;
  tenant_id: string;
};

async function recordAuthEvent(
  transaction: postgres.TransactionSql,
  tenantId: string,
  staffMemberId: string | null,
  eventType:
    | "account_locked"
    | "login_failed"
    | "login_succeeded"
    | "pin_revalidated"
    | "session_expired"
    | "session_revoked"
): Promise<void> {
  await transaction`
    insert into private.staff_auth_events (
      tenant_id,
      staff_member_id,
      event_type
    )
    values (${tenantId}::uuid, ${staffMemberId}::uuid, ${eventType})
  `;
}

export function createStaffAuthRepository(
  client: postgres.Sql
): StaffAuthRepository {
  return {
    async authenticate(input) {
      return client.begin(async (transaction) => {
        const [tenant] = await transaction<TenantRow[]>`
          select *
          from private.resolve_active_staff_tenant(${input.tenantSlug})
        `;

        if (!tenant) {
          await input.verifyPin(null);
          return { result: "tenant_not_found" };
        }

        const [candidate] = await transaction<StaffCandidateRow[]>`
          select *
          from private.lock_staff_login_candidate(
            ${tenant.id}::uuid,
            ${input.username}
          )
        `;

        const pinMatches = await input.verifyPin(candidate?.pin_hash ?? null);
        if (!candidate) {
          await recordAuthEvent(transaction, tenant.id, null, "login_failed");
          return { result: "invalid" };
        }

        const lockedUntil = candidate.locked_until
          ? new Date(candidate.locked_until)
          : null;
        const outcome = evaluatePinAttempt(
          {
            failedAttempts: candidate.failed_attempts,
            isActive: candidate.is_active,
            lockedUntil
          },
          pinMatches,
          input.now
        );

        if (outcome.result !== "authenticated") {
          const wasAlreadyLocked =
            lockedUntil !== null && lockedUntil > input.now;

          if (outcome.result === "invalid" || !wasAlreadyLocked) {
            await transaction`
              update private.staff_credentials
              set
                failed_attempts = ${outcome.failedAttempts},
                locked_until = ${outcome.lockedUntil?.toISOString() ?? null}::timestamptz,
                updated_at = ${input.now.toISOString()}::timestamptz
              where staff_member_id = ${candidate.staff_member_id}::uuid
            `;
          }

          await recordAuthEvent(
            transaction,
            tenant.id,
            candidate.staff_member_id,
            outcome.result === "locked" && !wasAlreadyLocked
              ? "account_locked"
              : "login_failed"
          );
          return { result: outcome.result };
        }

        await transaction`
          update private.staff_credentials
          set
            failed_attempts = 0,
            locked_until = null,
            updated_at = ${input.now.toISOString()}::timestamptz
          where staff_member_id = ${candidate.staff_member_id}::uuid
        `;
        await transaction`
          insert into private.staff_sessions (
            tenant_id,
            staff_member_id,
            token_hash,
            created_at,
            last_revalidated_at,
            expires_at
          )
          values (
            ${tenant.id}::uuid,
            ${candidate.staff_member_id}::uuid,
            ${input.tokenHash},
            ${input.now.toISOString()}::timestamptz,
            ${input.now.toISOString()}::timestamptz,
            ${input.expiresAt.toISOString()}::timestamptz
          )
        `;
        await recordAuthEvent(
          transaction,
          tenant.id,
          candidate.staff_member_id,
          "login_succeeded"
        );

        return {
          identity: {
            location: {
              id: candidate.location_id,
              name: candidate.location_name
            },
            staff: {
              displayName: candidate.display_name,
              id: candidate.staff_member_id,
              role: candidate.role
            },
            tenant
          },
          result: "authenticated"
        };
      });
    },
    async resolveSession(tokenHash, now) {
      return client.begin(async (transaction) => {
        const [session] = await transaction<StaffSessionRow[]>`
          select * from private.resolve_staff_session(${tokenHash})
        `;
        if (
          !session ||
          session.revoked_at !== null ||
          !session.is_active ||
          session.tenant_status !== "active"
        ) {
          return null;
        }

        const expiresAt = new Date(session.expires_at);
        if (expiresAt <= now) {
          const expired = await transaction<{ id: string }[]>`
            update private.staff_sessions
            set revoked_at = ${now.toISOString()}::timestamptz
            where id = ${session.session_id}::uuid
              and revoked_at is null
            returning id
          `;
          if (expired.length > 0) {
            await recordAuthEvent(
              transaction,
              session.tenant_id,
              session.staff_member_id,
              "session_expired"
            );
          }
          return null;
        }

        return {
          expiresAt,
          identity: {
            location: {
              id: session.location_id,
              name: session.location_name
            },
            staff: {
              displayName: session.display_name,
              id: session.staff_member_id,
              role: session.role
            },
            tenant: {
              id: session.tenant_id,
              name: session.tenant_name,
              slug: session.tenant_slug
            }
          },
          lastRevalidatedAt: new Date(session.last_revalidated_at)
        };
      });
    },
    async revalidate(input) {
      return client.begin(async (transaction) => {
        const [candidate] = await transaction<RevalidationCandidateRow[]>`
          select *
          from private.lock_staff_revalidation_candidate(${input.tokenHash})
        `;
        const pinMatches = await input.verifyPin(candidate?.pin_hash ?? null);
        if (
          !candidate ||
          candidate.revoked_at !== null ||
          new Date(candidate.expires_at) <= input.now ||
          candidate.role !== "manager"
        ) {
          return { result: "unauthorized" };
        }

        const lockedUntil = candidate.locked_until
          ? new Date(candidate.locked_until)
          : null;
        const outcome = evaluatePinAttempt(
          {
            failedAttempts: candidate.failed_attempts,
            isActive: candidate.is_active,
            lockedUntil
          },
          pinMatches,
          input.now
        );

        if (outcome.result !== "authenticated") {
          const wasAlreadyLocked =
            lockedUntil !== null && lockedUntil > input.now;
          if (outcome.result === "invalid" || !wasAlreadyLocked) {
            await transaction`
              update private.staff_credentials
              set
                failed_attempts = ${outcome.failedAttempts},
                locked_until = ${outcome.lockedUntil?.toISOString() ?? null}::timestamptz,
                updated_at = ${input.now.toISOString()}::timestamptz
              where staff_member_id = ${candidate.staff_member_id}::uuid
            `;
          }
          await recordAuthEvent(
            transaction,
            candidate.tenant_id,
            candidate.staff_member_id,
            outcome.result === "locked" && !wasAlreadyLocked
              ? "account_locked"
              : "login_failed"
          );
          return {
            result: outcome.result === "locked" ? "locked" : "invalid"
          };
        }

        await transaction`
          update private.staff_credentials
          set failed_attempts = 0,
              locked_until = null,
              updated_at = ${input.now.toISOString()}::timestamptz
          where staff_member_id = ${candidate.staff_member_id}::uuid
        `;
        await transaction`
          update private.staff_sessions
          set last_revalidated_at = ${input.now.toISOString()}::timestamptz
          where id = ${candidate.session_id}::uuid
        `;
        await recordAuthEvent(
          transaction,
          candidate.tenant_id,
          candidate.staff_member_id,
          "pin_revalidated"
        );
        return { revalidatedAt: input.now, result: "revalidated" };
      });
    },
    async revokeSession(tokenHash, now) {
      return client.begin(async (transaction) => {
        const [session] = await transaction<StaffSessionRow[]>`
          select * from private.resolve_staff_session(${tokenHash})
        `;
        if (!session || session.revoked_at !== null) {
          return false;
        }
        const revoked = await transaction<{ id: string }[]>`
          update private.staff_sessions
          set revoked_at = ${now.toISOString()}::timestamptz
          where id = ${session.session_id}::uuid
            and revoked_at is null
          returning id
        `;
        if (revoked.length === 0) {
          return false;
        }
        await recordAuthEvent(
          transaction,
          session.tenant_id,
          session.staff_member_id,
          "session_revoked"
        );
        return true;
      });
    }
  };
}
