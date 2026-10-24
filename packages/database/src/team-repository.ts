import {
  parseTenantScope,
  parseTeamMember,
  type TeamMember,
  type TeamMemberCreate,
  type TeamMemberUpdate,
  type TenantScope
} from "@platform/contracts";
import type { Sql } from "postgres";

export type CreateTeamMemberInput = {
  member: Omit<TeamMemberCreate, "pin">;
  /** scrypt-v1 hash produced by the API; the PIN itself never reaches SQL. */
  pinHash: string;
  requesterId: string;
  scope: TenantScope;
};

export type UpdateTeamMemberInput = {
  memberId: string;
  requesterId: string;
  scope: TenantScope;
  update: TeamMemberUpdate;
};

export type SetTeamMemberActiveInput = {
  active: boolean;
  memberId: string;
  requesterId: string;
  scope: TenantScope;
};

export type ResetTeamMemberPinInput = {
  memberId: string;
  pinHash: string;
  requesterId: string;
  scope: TenantScope;
};

export type TeamSummary = { activeManagers: number; activeMembers: number };

export interface TeamRepository {
  create(input: CreateTeamMemberInput): Promise<TeamMember>;
  getSummary(scope: TenantScope): Promise<TeamSummary>;
  list(scope: TenantScope, requesterId: string): Promise<TeamMember[]>;
  resetPin(input: ResetTeamMemberPinInput): Promise<void>;
  setActive(input: SetTeamMemberActiveInput): Promise<TeamMember>;
  update(input: UpdateTeamMemberInput): Promise<TeamMember>;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const hashPattern = /^scrypt-v1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/u;

function assertScope(scope: TenantScope): TenantScope {
  const parsed = parseTenantScope(scope);
  if (!parsed) throw new Error("tenant scope must be canonical");
  return parsed;
}

function assertUuid(value: string, field: string): void {
  if (!uuidPattern.test(value)) throw new Error(`${field} must be a UUID`);
}

function assertHash(value: string): void {
  if (!hashPattern.test(value)) throw new Error("credential must be a hash");
}

function mapMember(value: unknown): TeamMember {
  const member = parseTeamMember(value);
  if (!member) throw new Error("team member must be canonical");
  return member;
}

type ResultRow = { result: unknown };
type SummaryRow = { active_managers: number; active_members: number };

export function createTeamRepository(client: Sql): TeamRepository {
  return {
    async create(input) {
      const scope = assertScope(input.scope);
      assertUuid(input.requesterId, "requesterId");
      assertHash(input.pinHash);
      const { member } = input;
      const [row] = await client<ResultRow[]>`
        select private.create_staff_member(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${input.requesterId}::uuid,
          ${member.username},
          ${member.displayName},
          ${member.role},
          ${input.pinHash},
          ${member.sectorIds}::uuid[]
        ) as result
      `;
      if (!row) throw new Error("Team member creation returned no record");
      return mapMember(row.result);
    },

    async getSummary(untrustedScope) {
      const scope = assertScope(untrustedScope);
      const [row] = await client<SummaryRow[]>`
        select *
        from private.staff_team_summary(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid
        )
      `;
      return {
        activeManagers: row?.active_managers ?? 0,
        activeMembers: row?.active_members ?? 0
      };
    },

    async list(untrustedScope, requesterId) {
      const scope = assertScope(untrustedScope);
      assertUuid(requesterId, "requesterId");
      const [row] = await client<ResultRow[]>`
        select private.list_staff_members(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${requesterId}::uuid
        ) as result
      `;
      if (!row || !Array.isArray(row.result)) {
        throw new Error("Team list must be canonical");
      }
      return row.result.map(mapMember);
    },

    async resetPin(input) {
      const scope = assertScope(input.scope);
      assertUuid(input.requesterId, "requesterId");
      assertUuid(input.memberId, "memberId");
      assertHash(input.pinHash);
      await client`
        select private.reset_staff_pin(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${input.requesterId}::uuid,
          ${input.memberId}::uuid,
          ${input.pinHash}
        )
      `;
    },

    async setActive(input) {
      const scope = assertScope(input.scope);
      assertUuid(input.requesterId, "requesterId");
      assertUuid(input.memberId, "memberId");
      const [row] = await client<ResultRow[]>`
        select private.set_staff_active(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${input.requesterId}::uuid,
          ${input.memberId}::uuid,
          ${input.active}
        ) as result
      `;
      if (!row) throw new Error("Team activation returned no record");
      return mapMember(row.result);
    },

    async update(input) {
      const scope = assertScope(input.scope);
      assertUuid(input.requesterId, "requesterId");
      assertUuid(input.memberId, "memberId");
      const { update } = input;
      const [row] = await client<ResultRow[]>`
        select private.update_staff_member(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${input.requesterId}::uuid,
          ${input.memberId}::uuid,
          ${update.displayName},
          ${update.role},
          ${update.sectorIds}::uuid[]
        ) as result
      `;
      if (!row) throw new Error("Team update returned no record");
      return mapMember(row.result);
    }
  };
}
