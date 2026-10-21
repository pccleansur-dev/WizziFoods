import { Injectable, UnauthorizedException } from "@nestjs/common";
import type {
  IdentityAccess,
  IdentityAccessRepository
} from "@platform/database";

@Injectable()
export class TenantContextService {
  constructor(
    private readonly identityAccessRepository: IdentityAccessRepository
  ) {}

  async getForAuthenticatedIdentity(
    userId: string,
    sessionId: string
  ): Promise<IdentityAccess> {
    const access = await this.identityAccessRepository.resolveForIdentity(
      userId,
      sessionId
    );

    if (!access) {
      throw new UnauthorizedException({
        error: {
          code: "SESSION_REVOKED",
          message: "La sesión fue cerrada o revocada. Volvé a ingresar."
        }
      });
    }

    return access;
  }
}
