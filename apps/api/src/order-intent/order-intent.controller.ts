import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import { parseOrderIntentRequest } from "@platform/contracts";

import {
  TenantHostGuard,
  type TenantHostRequest
} from "../tenants/tenant-host.guard.js";
import { OrderIntentService } from "./order-intent.service.js";

type PublicRequest = Pick<TenantHostRequest, "tenantHostContext">;

function databaseCode(error: unknown): string | null {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : null;
}

function mapFailure(error: unknown): never {
  const code = databaseCode(error);
  if (code === "PT100") {
    throw new ConflictException({
      error: {
        code: "ORDER_INTENT_COMMAND_REUSED",
        message: "Ese envío ya se usó con otro pedido. Volvé a intentarlo."
      }
    });
  }
  if (code === "PT101" || code === "PT102") {
    throw new ConflictException({
      error: {
        code: "ORDER_INTENT_TABLE_CHANGED",
        message:
          "La mesa cambió y no pudimos aceptar el pedido. Escaneá nuevamente el QR."
      }
    });
  }
  if (code === "PT103") {
    throw new ConflictException({
      error: {
        code: "ORDER_INTENT_PAYMENT_CHANGED",
        message: "Ese medio de pago ya no está disponible. Elegí otro."
      }
    });
  }
  if (code === "PT104" || code === "PT105" || code === "PT106") {
    throw new ConflictException({
      error: {
        code: "ORDER_INTENT_ITEMS_CHANGED",
        message:
          "La disponibilidad del pedido cambió. Revisalo antes de volver a enviar."
      }
    });
  }
  if (code === "PT107") {
    throw new BadRequestException({
      error: { code: "INVALID_ORDER_INTENT", message: "Pedido inválido." }
    });
  }
  throw error;
}

@Controller("v1/public/order-intents")
@UseGuards(TenantHostGuard)
export class OrderIntentController {
  constructor(
    @Inject(OrderIntentService) private readonly service: OrderIntentService
  ) {}

  @Get("options")
  async options(@Req() request: PublicRequest) {
    return {
      data: {
        paymentMethods: await this.service.listPaymentMethods(
          request.tenantHostContext
        )
      }
    };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Req() request: PublicRequest, @Body() body: unknown) {
    const parsed = parseOrderIntentRequest(body);
    if (!parsed) {
      throw new BadRequestException({
        error: { code: "INVALID_ORDER_INTENT", message: "Pedido inválido." }
      });
    }
    try {
      return {
        data: await this.service.create(request.tenantHostContext, parsed)
      };
    } catch (error) {
      return mapFailure(error);
    }
  }
}
