import { timingSafeEqual } from "node:crypto";

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  Res,
  UnauthorizedException
} from "@nestjs/common";
import type { FastifyReply } from "fastify";

import { FakeMercadoPagoGateway } from "./fake-mercado-pago.gateway.js";

export const FAKE_MERCADO_PAGO = Symbol("FAKE_MERCADO_PAGO");

export type FakeMercadoPago = {
  gateway: FakeMercadoPagoGateway;
  redirectUri: string;
  secret: string;
};

const statePattern = /^[0-9A-Za-z_-]{43}$/u;
const simulated = [
  "approved",
  "authorized",
  "cancelled",
  "charged_back",
  "in_process",
  "pending",
  "refunded",
  "rejected"
];

function sameSecret(received: string | undefined, secret: string): boolean {
  const left = Buffer.from(received ?? "");
  const right = Buffer.from(`Bearer ${secret}`);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * The sandbox side of Mercado Pago. It exists only when the API runs with the fake
 * gateway (never in production): a consent screen that approves at once, and a
 * control to decide later what a payment became, the way the provider would.
 */
@Controller("v1/dev/mercado-pago")
export class FakeMercadoPagoController {
  constructor(
    @Inject(FAKE_MERCADO_PAGO) private readonly fake: FakeMercadoPago
  ) {}

  /** Stands in for the consent screen: every authorization is granted. */
  @Get("authorize")
  authorize(@Query("state") state: unknown, @Res() reply: FastifyReply) {
    if (typeof state !== "string" || !statePattern.test(state)) {
      throw new BadRequestException({
        error: { code: "INVALID_STATE", message: "Estado inválido." }
      });
    }
    const target = new URL(this.fake.redirectUri);
    target.searchParams.set(
      "code",
      this.fake.gateway.codeFor(this.fake.gateway.newSellerId())
    );
    target.searchParams.set("state", state);
    return reply
      .status(302)
      .header("cache-control", "no-store")
      .header("location", target.toString())
      .send();
  }

  /** The provider decides later: approves a pending payment, rejects it, refunds it. */
  @Post("payments/:providerPaymentId")
  @HttpCode(HttpStatus.OK)
  simulate(
    @Param("providerPaymentId") providerPaymentId: string,
    @Body() body: unknown,
    @Headers("authorization") authorization: string | undefined
  ) {
    if (!sameSecret(authorization, this.fake.secret)) {
      throw new UnauthorizedException({
        error: { code: "SANDBOX_UNAUTHORIZED", message: "No autorizado." }
      });
    }
    const change = body as {
      refundedCents?: unknown;
      status?: unknown;
      statusDetail?: unknown;
    } | null;
    if (
      !change ||
      typeof change.status !== "string" ||
      !simulated.includes(change.status) ||
      (change.refundedCents !== undefined &&
        (typeof change.refundedCents !== "number" ||
          !Number.isInteger(change.refundedCents) ||
          change.refundedCents < 0)) ||
      (change.statusDetail !== undefined &&
        (typeof change.statusDetail !== "string" ||
          change.statusDetail.length > 100))
    ) {
      throw new BadRequestException({
        error: { code: "INVALID_SANDBOX_CHANGE", message: "Cambio inválido." }
      });
    }
    this.fake.gateway.simulate(providerPaymentId, {
      refundedCents: change.refundedCents,
      status: change.status,
      statusDetail: change.statusDetail
    });
    return { data: { simulated: true } };
  }
}
