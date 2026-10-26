import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Query,
  Req,
  Res,
  UseGuards
} from "@nestjs/common";
import {
  parseRedeemDinerLoginRequest,
  parseStartDinerLoginRequest
} from "@platform/contracts";
import type { FastifyReply } from "fastify";

import {
  TenantHostGuard,
  type TenantHostRequest
} from "../tenants/tenant-host.guard.js";
import { mapDinerFailure } from "./diner-errors.js";
import { DinerIdentityService } from "./diner-identity.service.js";

export const DINER_AUTH_AVAILABLE = Symbol("DINER_AUTH_AVAILABLE");

function bearer(header: string | undefined): string | undefined {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/u.exec(header ?? "");
  return match?.[1];
}

function invalid(): BadRequestException {
  return new BadRequestException({
    error: { code: "INVALID_DINER_REQUEST", message: "Revisá los datos." }
  });
}

/**
 * Login with Google is always optional: this controller only starts it, trades the
 * one-time code for a session, and ends it. The restaurant comes from the host; the
 * browser never names a tenant, an account or an email.
 */
@Controller("v1/public/diner-auth")
@UseGuards(TenantHostGuard)
export class DinerAuthController {
  constructor(
    @Inject(DinerIdentityService) private readonly diners: DinerIdentityService,
    @Inject(DINER_AUTH_AVAILABLE) private readonly available: boolean
  ) {}

  @Get("availability")
  availability() {
    return { data: { available: this.available } };
  }

  @Post("start")
  @HttpCode(HttpStatus.OK)
  async start(@Req() request: TenantHostRequest, @Body() body: unknown) {
    const parsed = parseStartDinerLoginRequest(body);
    if (!parsed) throw invalid();
    try {
      return {
        data: {
          authorizeUrl: await this.diners.start({
            ...parsed,
            host: String(request.headers.host),
            tenantId: request.tenantHostContext.tenant.id
          })
        }
      };
    } catch (error) {
      return mapDinerFailure(error);
    }
  }

  @Post("session")
  @HttpCode(HttpStatus.OK)
  async redeem(@Req() request: TenantHostRequest, @Body() body: unknown) {
    const parsed = parseRedeemDinerLoginRequest(body);
    if (!parsed) throw invalid();
    try {
      return {
        data: {
          sessionToken: await this.diners.redeem({
            ...parsed,
            tenantId: request.tenantHostContext.tenant.id
          })
        }
      };
    } catch (error) {
      return mapDinerFailure(error);
    }
  }

  @Delete("session")
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: TenantHostRequest,
    @Headers("authorization") authorization: string | undefined
  ) {
    const token = bearer(authorization);
    if (!token) return;
    await this.diners.logout(request.tenantHostContext.tenant.id, token);
  }
}

/**
 * Where Google sends the diner back. It is on the platform host, not on a
 * restaurant: the signed `state` says which restaurant started the login, and the
 * response only ever redirects to that restaurant's own host.
 */
@Controller("v1/diner-auth/google")
export class DinerAuthCallbackController {
  constructor(
    @Inject(DinerIdentityService) private readonly diners: DinerIdentityService
  ) {}

  @Get("callback")
  async callback(
    @Query("code") code: unknown,
    @Query("state") state: unknown,
    @Query("error") denied: unknown,
    @Res() reply: FastifyReply
  ) {
    if (typeof state !== "string" || state.length > 2000) throw invalid();
    // A diner who closes or refuses Google's screen simply returns to the menu.
    const target =
      typeof code !== "string" || code.length === 0 || denied !== undefined
        ? await this.diners.cancel(state)
        : await this.diners.complete({ code, state }).catch(mapDinerFailure);
    return reply
      .status(302)
      .header("cache-control", "no-store")
      .header("location", target)
      .send();
  }
}

/** Development stand-in for Google's account chooser (only with the fake gateway). */
@Controller("v1/dev/fake-google")
export class FakeGoogleController {
  @Get("authorize")
  authorize(@Query("state") state: unknown, @Res() reply: FastifyReply) {
    if (typeof state !== "string" || !/^[\w.-]{20,2000}$/u.test(state)) {
      throw invalid();
    }
    const escaped = state.replace(/[^\w.-]/gu, "");
    return reply
      .status(200)
      .header("content-type", "text/html; charset=utf-8")
      .header("cache-control", "no-store")
      .send(`<!doctype html><meta charset="utf-8"><title>Google (simulado)</title>
<form method="get" action="/v1/diner-auth/google/callback" style="font-family:sans-serif;max-width:24rem;margin:3rem auto">
<h1>Google (simulado)</h1>
<input type="hidden" name="state" value="${escaped}">
<label>Correo <input name="code" type="text" value="fake:" style="width:100%"></label>
<p><button type="submit">Continuar</button></p></form>`);
  }
}
