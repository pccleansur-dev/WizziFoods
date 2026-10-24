import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Put,
  Req,
  UnprocessableEntityException,
  UseGuards
} from "@nestjs/common";
import {
  parsePaymentMethodKey,
  parsePaymentMethodUpdate,
  parsePaymentSecretRequest,
  PROVIDER_PAYMENT_METHODS,
  type PaymentIssue,
  type PaymentMethodKey,
  type PaymentParseResult
} from "@platform/contracts";

import { AdminAuthGuard } from "../auth/admin-auth.guard.js";
import {
  TenantAdminScopeGuard,
  type TenantAdminScopedRequest
} from "../tenants/tenant-admin-scope.guard.js";
import { TenantHostGuard } from "../tenants/tenant-host.guard.js";
import { PaymentMethodsService } from "./payment-methods.service.js";

type PaymentRequest = Pick<TenantAdminScopedRequest, "tenantAdminContext">;

function databaseCode(error: unknown): string | null {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : null;
}

/** Translates database failures without echoing any database detail. */
function mapFailure(error: unknown): never {
  switch (databaseCode(error)) {
    case "PT004":
      throw new ConflictException({
        error: {
          code: "PAYMENT_LAST_METHOD",
          message:
            "Debe quedar al menos un medio de pago disponible. Habilitá otro antes de deshabilitar este."
        }
      });
    case "PT003":
      throw new UnprocessableEntityException({
        error: {
          code: "PAYMENT_PROVIDER_NOT_CONFIGURED",
          message:
            "Cargá la clave pública y la credencial del proveedor antes de habilitarlo."
        }
      });
    case "22023":
    case "23514":
      throw new UnprocessableEntityException({
        error: {
          code: "PAYMENT_INVALID_STATE",
          message: "La configuración del medio de pago no es válida."
        }
      });
    default:
      throw error;
  }
}

function method(raw: unknown): PaymentMethodKey {
  const key = parsePaymentMethodKey(raw);
  if (!key) {
    throw new BadRequestException({
      error: { code: "INVALID_PAYMENT_METHOD", message: "Medio inválido." }
    });
  }
  return key;
}

function valueOf<T>(result: PaymentParseResult<T>): T {
  if (result.ok) return result.value;
  throw new BadRequestException({
    error: {
      code: "INVALID_PAYMENT_REQUEST",
      issues: result.issues satisfies PaymentIssue[],
      message: "Revisá los datos marcados."
    }
  });
}

@Controller("v1/tenant/payment-methods")
@UseGuards(AdminAuthGuard, TenantHostGuard, TenantAdminScopeGuard)
export class PaymentMethodsAdminController {
  constructor(
    @Inject(PaymentMethodsService)
    private readonly service: PaymentMethodsService
  ) {}

  @Get()
  async list(@Req() request: PaymentRequest) {
    return { data: await this.service.list(request.tenantAdminContext) };
  }

  @Put(":method")
  async update(
    @Req() request: PaymentRequest,
    @Param("method") rawMethod: unknown,
    @Body() body: unknown
  ) {
    const key = method(rawMethod);
    const update = valueOf(parsePaymentMethodUpdate(key, body));
    try {
      return {
        data: await this.service.update(request.tenantAdminContext, key, update)
      };
    } catch (error) {
      return mapFailure(error);
    }
  }

  @Put(":method/credential")
  async storeCredential(
    @Req() request: PaymentRequest,
    @Param("method") rawMethod: unknown,
    @Body() body: unknown
  ) {
    const key = method(rawMethod);
    const { secret } = valueOf(parsePaymentSecretRequest(key, body));
    try {
      return {
        data: await this.service.storeCredential(
          request.tenantAdminContext,
          key,
          secret
        )
      };
    } catch (error) {
      return mapFailure(error);
    }
  }

  @Delete(":method/credential")
  async clearCredential(
    @Req() request: PaymentRequest,
    @Param("method") rawMethod: unknown
  ) {
    const key = method(rawMethod);
    if (!PROVIDER_PAYMENT_METHODS.includes(key)) {
      throw new BadRequestException({
        error: {
          code: "INVALID_PAYMENT_METHOD",
          message: "Este medio no usa credenciales."
        }
      });
    }
    try {
      return {
        data: await this.service.clearCredential(
          request.tenantAdminContext,
          key
        )
      };
    } catch (error) {
      return mapFailure(error);
    }
  }
}
