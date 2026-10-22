import {
  ForbiddenException,
  Injectable,
  UnauthorizedException
} from "@nestjs/common";
import type {
  IdentityAccessRepository,
  TenantSuspensionRecord,
  TenantSuspensionRepository
} from "@platform/database";

import type { AdminIdentity } from "../auth/admin-auth.service.js";
import type { TenantSuspensionRequest } from "./tenant-suspension-input.js";

@Injectable()
export class TenantSuspensionService {
  constructor(
    private readonly identityAccessRepository: IdentityAccessRepository,
    private readonly tenantSuspensionRepository: TenantSuspensionRepository
  ) {}

  async request(
    identity: AdminIdentity,
    tenantId: string,
    request: TenantSuspensionRequest,
    correlationId: string
  ): Promise<TenantSuspensionRecord> {
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

    return this.tenantSuspensionRepository.request({
      actorUserId: identity.userId,
      correlationId,
      mode: request.mode,
      reason: request.reason,
      tenantId
    });
  }
}
