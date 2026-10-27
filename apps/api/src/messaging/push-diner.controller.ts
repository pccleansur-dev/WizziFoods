import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import {
  parsePushEndpointRequest,
  parsePushSubscriptionRequest
} from "@platform/contracts";

import { mapDinerFailure } from "../diner-identity/diner-errors.js";
import { DinerIdentityService } from "../diner-identity/diner-identity.service.js";
import {
  TenantHostGuard,
  type TenantHostRequest
} from "../tenants/tenant-host.guard.js";
import { MessagingService } from "./messaging.service.js";

function invalid(): BadRequestException {
  return new BadRequestException({
    error: {
      code: "INVALID_PUSH_REQUEST",
      message: "No pudimos activar los avisos en este dispositivo."
    }
  });
}

function databaseCode(error: unknown): string | null {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : null;
}

/**
 * Notifications of the installed PWA, from the diner's side. The account comes from the
 * diner session and the restaurant from the host. Turning them on is the diner's own
 * act: the browser asks for permission and this records the subscription.
 */
@Controller("v1/public/diner/push")
@UseGuards(TenantHostGuard)
export class PushDinerController {
  constructor(
    @Inject(DinerIdentityService) private readonly diners: DinerIdentityService,
    @Inject(MessagingService) private readonly messaging: MessagingService
  ) {}

  private async accountOf(
    request: TenantHostRequest,
    authorization: string | undefined
  ): Promise<string> {
    const token = /^Bearer (\S+)$/u.exec(authorization ?? "")?.[1];
    try {
      return await this.diners.authenticate(
        request.tenantHostContext.tenant.id,
        token
      );
    } catch (error) {
      return mapDinerFailure(error);
    }
  }

  private scope(request: TenantHostRequest) {
    return {
      locationId: request.tenantHostContext.location.id,
      tenantId: request.tenantHostContext.tenant.id
    };
  }

  private fail(error: unknown): never {
    if (databaseCode(error) === "PT297") throw invalid();
    return mapDinerFailure(error);
  }

  /** Whether this deployment offers push, and the public key the browser needs. */
  @Get("config")
  config() {
    return { data: this.messaging.pushConfig() };
  }

  @Post("subscriptions")
  @HttpCode(HttpStatus.OK)
  async subscribe(
    @Req() request: TenantHostRequest,
    @Headers("authorization") authorization: string | undefined,
    @Body() body: unknown
  ) {
    const parsed = parsePushSubscriptionRequest(body);
    if (!parsed) throw invalid();
    const accountId = await this.accountOf(request, authorization);
    try {
      return {
        data: await this.messaging.registerPush(
          this.scope(request),
          accountId,
          parsed
        )
      };
    } catch (error) {
      return this.fail(error);
    }
  }

  /** Is this very browser subscribed? The endpoint comes from the browser itself. */
  @Post("subscriptions/state")
  @HttpCode(HttpStatus.OK)
  async state(
    @Req() request: TenantHostRequest,
    @Headers("authorization") authorization: string | undefined,
    @Body() body: unknown
  ) {
    const parsed = parsePushEndpointRequest(body);
    if (!parsed) throw invalid();
    const accountId = await this.accountOf(request, authorization);
    try {
      return {
        data: await this.messaging.pushState(
          this.scope(request),
          accountId,
          parsed.endpoint
        )
      };
    } catch (error) {
      return this.fail(error);
    }
  }

  @Post("subscriptions/revoke")
  @HttpCode(HttpStatus.OK)
  async unsubscribe(
    @Req() request: TenantHostRequest,
    @Headers("authorization") authorization: string | undefined,
    @Body() body: unknown
  ) {
    const parsed = parsePushEndpointRequest(body);
    if (!parsed) throw invalid();
    const accountId = await this.accountOf(request, authorization);
    try {
      return {
        data: await this.messaging.unregisterPush(
          this.scope(request),
          accountId,
          parsed.endpoint
        )
      };
    } catch (error) {
      return this.fail(error);
    }
  }
}
