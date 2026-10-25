import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Query
} from "@nestjs/common";

import { MercadoPagoService } from "./mercado-pago.service.js";

/**
 * Where Mercado Pago announces that a payment changed. It is public by nature and
 * therefore trusts nothing it receives: the signature is checked first, duplicates
 * are recorded once, and the state is read back from Mercado Pago itself.
 */
@Controller("v1/webhooks/mercado-pago")
export class MercadoPagoWebhookController {
  constructor(
    @Inject(MercadoPagoService) private readonly service: MercadoPagoService
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async receive(
    @Body() body: unknown,
    @Headers("x-signature") signature: string | undefined,
    @Headers("x-request-id") requestId: string | undefined,
    @Query() query: Record<string, unknown>
  ) {
    const queryDataId = query["data.id"];
    return {
      data: await this.service.handleWebhook({
        body,
        queryDataId: typeof queryDataId === "string" ? queryDataId : null,
        requestId: requestId ?? null,
        signature: signature ?? null
      })
    };
  }
}
