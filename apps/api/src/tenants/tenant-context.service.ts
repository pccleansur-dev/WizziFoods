import { Injectable } from "@nestjs/common";
import type {
  IdentityAccess,
  IdentityAccessRepository
} from "@platform/database";

@Injectable()
export class TenantContextService {
  constructor(
    private readonly identityAccessRepository: IdentityAccessRepository
  ) {}

  getForAuthenticatedIdentity(userId: string): Promise<IdentityAccess> {
    return this.identityAccessRepository.resolveForIdentity(userId);
  }
}
