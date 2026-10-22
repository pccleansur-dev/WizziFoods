import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  UnauthorizedException
} from "@nestjs/common";

import {
  parseStaffAccessToken,
  parseStaffLogin,
  parseStaffRevalidation,
  parseTenantSlug
} from "./staff-auth-input.js";
import { StaffAuthService } from "./staff-auth.service.js";

function invalidStaffLogin(): BadRequestException {
  return new BadRequestException({
    error: {
      code: "INVALID_STAFF_LOGIN",
      message: "Revisá el negocio, usuario y PIN ingresados."
    }
  });
}

function invalidStaffSession(): UnauthorizedException {
  return new UnauthorizedException({
    error: {
      code: "STAFF_SESSION_INVALID",
      message: "La sesión del personal venció o ya no está disponible."
    }
  });
}

function parseAuthorizationHeader(value: string | undefined): string {
  try {
    return parseStaffAccessToken(value);
  } catch {
    throw invalidStaffSession();
  }
}

@Controller("v1/tenants/:tenantSlug/staff-sessions")
export class StaffAuthController {
  constructor(
    @Inject(StaffAuthService) private readonly service: StaffAuthService
  ) {}

  @Post()
  async create(
    @Param("tenantSlug") tenantSlug: string,
    @Body() body: unknown
  ): Promise<{ data: Awaited<ReturnType<StaffAuthService["signIn"]>> }> {
    let parsedTenantSlug: string;
    let parsedLogin: ReturnType<typeof parseStaffLogin>;

    try {
      parsedTenantSlug = parseTenantSlug(tenantSlug);
      parsedLogin = parseStaffLogin(body);
    } catch {
      throw invalidStaffLogin();
    }

    return {
      data: await this.service.signIn(parsedTenantSlug, parsedLogin)
    };
  }
}

@Controller("v1/staff-sessions/current")
export class StaffSessionController {
  constructor(
    @Inject(StaffAuthService) private readonly service: StaffAuthService
  ) {}

  @Get()
  async getCurrent(
    @Headers("authorization") authorization: string | undefined
  ): Promise<{
    data: Awaited<ReturnType<StaffAuthService["currentSession"]>>;
  }> {
    return {
      data: await this.service.currentSession(
        parseAuthorizationHeader(authorization)
      )
    };
  }

  @Delete()
  @HttpCode(204)
  async deleteCurrent(
    @Headers("authorization") authorization: string | undefined
  ): Promise<void> {
    await this.service.signOut(parseAuthorizationHeader(authorization));
  }

  @Post("revalidations")
  async createRevalidation(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: unknown
  ): Promise<{ data: Awaited<ReturnType<StaffAuthService["revalidate"]>> }> {
    let request: ReturnType<typeof parseStaffRevalidation>;
    try {
      request = parseStaffRevalidation(body);
    } catch {
      throw new BadRequestException({
        error: {
          code: "INVALID_STAFF_REVALIDATION",
          message: "Ingresá un PIN válido de seis dígitos."
        }
      });
    }
    return {
      data: await this.service.revalidate(
        parseAuthorizationHeader(authorization),
        request
      )
    };
  }
}
