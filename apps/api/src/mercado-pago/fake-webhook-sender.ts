import { randomUUID } from "node:crypto";

import type { FakeChange } from "./fake-mercado-pago.gateway.js";
import { signatureHeader } from "./webhook-signature.js";

type Send = typeof fetch;

/**
 * What the real provider does after a payment changes: a signed POST to the
 * application's webhook. The sandbox sends it to this very API, so the whole path
 * (signature, deduplication, authoritative fetch) runs exactly as in production.
 */
export function createFakeWebhookSender(options: {
  delayMs?: number;
  now?: () => Date;
  send?: Send;
  secret: string;
  url: string;
}): (change: FakeChange) => void {
  const send = options.send ?? fetch;
  const now = options.now ?? (() => new Date());
  let notificationId = 100_000;
  return (change) => {
    const id = notificationId++;
    const requestId = randomUUID();
    const ts = String(Math.floor(now().getTime() / 1000));
    const body = {
      action: "payment.updated",
      api_version: "v1",
      data: { id: change.dataId },
      date_created: now().toISOString(),
      id,
      live_mode: false,
      type: "payment",
      user_id: change.userId
    };
    setTimeout(() => {
      void send(
        `${options.url}?data.id=${encodeURIComponent(change.dataId)}&type=payment`,
        {
          body: JSON.stringify(body),
          headers: {
            "content-type": "application/json",
            "x-request-id": requestId,
            "x-signature": signatureHeader(options.secret, {
              dataId: change.dataId,
              requestId,
              ts
            })
          },
          method: "POST"
        }
      ).catch(() => undefined);
    }, options.delayMs ?? 25);
  };
}
