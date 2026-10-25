import type { ApiRuntimeConfig } from "@platform/config";

import { FakeMercadoPagoGateway } from "./fake-mercado-pago.gateway.js";
import type { FakeMercadoPago } from "./fake-mercado-pago.controller.js";
import { createFakeWebhookSender } from "./fake-webhook-sender.js";
import { HttpMercadoPagoGateway } from "./http-mercado-pago.gateway.js";
import type { MercadoPagoGateway } from "./mercado-pago.gateway.js";

export type MercadoPagoRuntime = {
  fake: FakeMercadoPago | null;
  gateway: MercadoPagoGateway | null;
  returnUrl: string;
  webhookSecret: string | null;
};

/** Builds the gateway the configuration asks for; nothing is created when it is off. */
export function createMercadoPagoRuntime(
  config: ApiRuntimeConfig
): MercadoPagoRuntime {
  const settings = config.mercadoPago ?? { mode: "off" as const };
  if (settings.mode === "off") {
    return {
      fake: null,
      gateway: null,
      returnUrl: new URL(
        "/panel/pagos",
        config.adminInviteRedirectUrl
      ).toString(),
      webhookSecret: null
    };
  }
  if (settings.mode === "fake") {
    const gateway = new FakeMercadoPagoGateway({
      onChange: createFakeWebhookSender({
        secret: settings.webhookSecret,
        url: `http://127.0.0.1:${config.port}/v1/webhooks/mercado-pago`
      }),
      redirectUri: settings.redirectUri
    });
    return {
      fake: {
        gateway,
        redirectUri: settings.redirectUri,
        secret: settings.webhookSecret
      },
      gateway,
      returnUrl: settings.returnUrl,
      webhookSecret: settings.webhookSecret
    };
  }
  return {
    fake: null,
    gateway: new HttpMercadoPagoGateway({
      clientId: settings.clientId,
      clientSecret: settings.clientSecret,
      redirectUri: settings.redirectUri
    }),
    returnUrl: settings.returnUrl,
    webhookSecret: settings.webhookSecret
  };
}
