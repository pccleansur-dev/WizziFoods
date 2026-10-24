import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException
} from "@nestjs/common";
import type {
  StaffCapability,
  StaffRole,
  TenantScope
} from "@platform/contracts";
import type { FastifyRequest } from "fastify";

import { parseStaffAccessToken } from "./staff-auth-input.js";
import { StaffAuthService } from "./staff-auth.service.js";

/**
 * Everything an operational staff endpoint may trust. It comes exclusively from
 * the opaque Bearer session: tenant, location, identity, role and capabilities
 * are never read from the body, query or any other header.
 */
export type StaffRequestContext = {
  capabilities: readonly StaffCapability[];
  role: StaffRole;
  scope: TenantScope;
  staffId: string;
};

export type StaffSessionRequest = FastifyRequest & {
  staffContext: StaffRequestContext;
};

@Injectable()
export class StaffSessionGuard implements CanActivate {
  constructor(
    @Inject(StaffAuthService) private readonly service: StaffAuthService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<FastifyRequest & { staffContext?: StaffRequestContext }>();
    let token: string;
    try {
      token = parseStaffAccessToken(request.headers.authorization);
    } catch {
      throw new UnauthorizedException({
        error: {
          code: "STAFF_SESSION_INVALID",
          message: "La sesión del personal venció o ya no está disponible."
        }
      });
    }
    // Resolved against the database on every request: a revoked, expired or
    // deactivated session stops working immediately.
    const session = await this.service.currentSession(token);
    request.staffContext = {
      capabilities: session.identity.staff.capabilities,
      role: session.identity.staff.role,
      scope: {
        locationId: session.identity.location.id,
        tenantId: session.identity.tenant.id
      },
      staffId: session.identity.staff.id
    };
    return true;
  }
}
