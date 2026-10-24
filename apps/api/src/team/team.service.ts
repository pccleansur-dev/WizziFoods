import type {
  TeamMember,
  TeamMemberCreate,
  TeamMemberUpdate
} from "@platform/contracts";
import type { TeamRepository } from "@platform/database";

import { hashStaffPin } from "../staff-auth/pin-credential.js";
import type { TenantAdminRequestContext } from "../tenants/tenant-admin-scope.service.js";

export class TeamService {
  constructor(
    private readonly repository: TeamRepository,
    private readonly pinPepper: string
  ) {}

  list(context: TenantAdminRequestContext): Promise<TeamMember[]> {
    return this.repository.list(context.scope, context.identity.userId);
  }

  async create(
    context: TenantAdminRequestContext,
    input: TeamMemberCreate
  ): Promise<TeamMember> {
    const { pin, ...member } = input;
    return this.repository.create({
      member,
      pinHash: await hashStaffPin(pin, this.pinPepper),
      requesterId: context.identity.userId,
      scope: context.scope
    });
  }

  update(
    context: TenantAdminRequestContext,
    memberId: string,
    update: TeamMemberUpdate
  ): Promise<TeamMember> {
    return this.repository.update({
      memberId,
      requesterId: context.identity.userId,
      scope: context.scope,
      update
    });
  }

  setActive(
    context: TenantAdminRequestContext,
    memberId: string,
    active: boolean
  ): Promise<TeamMember> {
    return this.repository.setActive({
      active,
      memberId,
      requesterId: context.identity.userId,
      scope: context.scope
    });
  }

  async resetPin(
    context: TenantAdminRequestContext,
    memberId: string,
    pin: string
  ): Promise<void> {
    await this.repository.resetPin({
      memberId,
      pinHash: await hashStaffPin(pin, this.pinPepper),
      requesterId: context.identity.userId,
      scope: context.scope
    });
  }
}
