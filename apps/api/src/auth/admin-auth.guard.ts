import {
  type CanActivate,
  type ExecutionContext,
  Injectable
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";

import { AdminAuthService, type AdminIdentity } from "./admin-auth.service.js";
import { extractBearerToken } from "./bearer-token.js";

export type AdminAuthenticatedRequest = FastifyRequest & {
  adminIdentity: AdminIdentity;
};

type PendingAdminRequest = FastifyRequest & {
  adminIdentity?: AdminIdentity;
};

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(private readonly authService: AdminAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<PendingAdminRequest>();
    const token = extractBearerToken(request.headers.authorization);
    request.adminIdentity = await this.authService.authenticate(token);
    return true;
  }
}
