import {
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Query,
  Req,
  type RawBodyRequest
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";

import { MessagingService } from "./messaging.service.js";

/**
 * Where Meta reports deliveries and replies. It is public by nature, so it trusts
 * nothing it receives: the signature of the exact bytes is checked first, every
 * notification is recorded once, and the restaurant is found from the number the
 * notification names, never from anything the sender says about it.
 */
@Controller("v1/webhooks/whatsapp")
export class WhatsappWebhookController {
  constructor(
    @Inject(MessagingService) private readonly service: MessagingService
  ) {}

  /** Meta's handshake: echoes the challenge only for the right verify token. */
  @Get()
  @Header("content-type", "text/plain; charset=utf-8")
  verify(@Query() query: Record<string, unknown>): string {
    const read = (key: string) =>
      typeof query[key] === "string" ? query[key] : undefined;
    return this.service.verifyHandshake({
      challenge: read("hub.challenge"),
      mode: read("hub.mode"),
      token: read("hub.verify_token")
    });
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  async receive(
    @Req() request: RawBodyRequest<FastifyRequest>,
    @Headers("x-hub-signature-256") signature: string | undefined
  ) {
    return {
      data: await this.service.handleWebhook({
        rawBody: request.rawBody,
        signature
      })
    };
  }
}
