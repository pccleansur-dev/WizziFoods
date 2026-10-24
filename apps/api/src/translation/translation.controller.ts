import {
  BadGatewayException,
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Inject,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import { parseTranslationRequest } from "@platform/contracts";

import { AdminAuthGuard } from "../auth/admin-auth.guard.js";
import {
  TenantAdminScopeGuard,
  type TenantAdminScopedRequest
} from "../tenants/tenant-admin-scope.guard.js";
import { TenantHostGuard } from "../tenants/tenant-host.guard.js";
import { TranslationFailedError } from "./anthropic-translation.gateway.js";
import { TranslationService } from "./translation.service.js";

type TranslationRequestContext = Pick<
  TenantAdminScopedRequest,
  "tenantAdminContext"
>;

@Controller("v1/tenant/catalog/translations")
@UseGuards(AdminAuthGuard, TenantHostGuard, TenantAdminScopeGuard)
export class TranslationAdminController {
  constructor(
    @Inject(TranslationService) private readonly service: TranslationService
  ) {}

  @Post()
  @HttpCode(200)
  async translate(
    @Req() _request: TranslationRequestContext,
    @Body() body: unknown
  ) {
    const parsed = parseTranslationRequest(body);
    if (!parsed) {
      throw new BadRequestException({
        error: {
          code: "INVALID_TRANSLATION_REQUEST",
          message: "Revisá los textos y los idiomas a traducir."
        }
      });
    }
    try {
      return { data: { translations: await this.service.translate(parsed) } };
    } catch (error) {
      if (error instanceof TranslationFailedError) {
        throw new BadGatewayException({
          error: {
            code: "TRANSLATION_FAILED",
            message:
              "No pudimos traducir ahora. Intentá de nuevo en un momento."
          }
        });
      }
      throw error;
    }
  }
}
