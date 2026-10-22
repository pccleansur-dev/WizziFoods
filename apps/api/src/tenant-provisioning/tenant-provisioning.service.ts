import {
  ForbiddenException,
  Injectable,
  UnauthorizedException
} from "@nestjs/common";
import type {
  CreateTenantProvisioningRequest,
  TenantProvisioningView
} from "@platform/contracts";
import type {
  IdentityAccessRepository,
  TenantProvisioningRecord,
  TenantProvisioningRepository
} from "@platform/database";

import type { AdminIdentity } from "../auth/admin-auth.service.js";
import type { TenantAdminInvitationGateway } from "./tenant-admin-invitation.gateway.js";

@Injectable()
export class TenantProvisioningService {
  constructor(
    private readonly identityAccessRepository: IdentityAccessRepository,
    private readonly provisioningRepository: TenantProvisioningRepository,
    private readonly invitationGateway: TenantAdminInvitationGateway,
    private readonly invitationRedirectUrl: string
  ) {}

  async create(
    identity: AdminIdentity,
    idempotencyKey: string,
    request: CreateTenantProvisioningRequest
  ): Promise<TenantProvisioningView> {
    const access = await this.identityAccessRepository.resolveForIdentity(
      identity.userId,
      identity.sessionId
    );
    if (!access) {
      throw new UnauthorizedException({
        error: {
          code: "SESSION_REVOKED",
          message: "La sesión fue cerrada o revocada. Volvé a ingresar."
        }
      });
    }
    if (access.type !== "platform_superadmin") {
      throw new ForbiddenException({
        error: {
          code: "PLATFORM_SUPERADMIN_REQUIRED",
          message: "Esta acción requiere acceso de superadministración."
        }
      });
    }

    let provisioning = await this.provisioningRepository.begin({
      actorUserId: identity.userId,
      idempotencyKey,
      request
    });
    if (provisioning.status === "pending_invitation") {
      const invited = await this.invitationGateway.invite({
        email: provisioning.adminEmail,
        redirectTo: this.invitationRedirectUrl,
        requestId: provisioning.requestId
      });
      provisioning = await this.provisioningRepository.complete({
        actorUserId: identity.userId,
        authUserId: invited.userId,
        requestId: provisioning.requestId
      });
    }

    return this.toView(provisioning);
  }

  private toView(record: TenantProvisioningRecord): TenantProvisioningView {
    return {
      adminEmail: record.adminEmail,
      location: record.location,
      requestId: record.requestId,
      status: record.status,
      tenant: record.tenant
    };
  }
}
