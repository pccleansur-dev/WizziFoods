import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Meta signs the exact bytes of the body with the app secret (HMAC-SHA256) and sends
 * `X-Hub-Signature-256: sha256=<hex>`. The signature is checked before anything is parsed.
 */
export function signWebhookBody(
  secret: string,
  rawBody: Buffer | string
): string {
  return `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}

export function verifyWebhookBody(input: {
  header: string | null | undefined;
  rawBody: Buffer | string;
  secret: string;
}): boolean {
  if (!input.header || !/^sha256=[0-9a-f]{64}$/u.test(input.header)) {
    return false;
  }
  const expected = Buffer.from(signWebhookBody(input.secret, input.rawBody));
  const received = Buffer.from(input.header);
  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  );
}

export type WhatsappWebhookEvent =
  | {
      error: string | null;
      eventKey: string;
      kind: "status";
      phoneNumberId: string;
      providerMessageId: string;
      status: "delivered" | "failed" | "read";
    }
  | {
      eventKey: string;
      from: string;
      kind: "message";
      phoneNumberId: string;
      text: string;
    };

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Reads the notification defensively: whatever is not understood is dropped. */
export function parseWhatsappWebhook(body: unknown): WhatsappWebhookEvent[] {
  const events: WhatsappWebhookEvent[] = [];
  const root = record(body);
  if (
    !root ||
    root.object !== "whatsapp_business_account" ||
    !Array.isArray(root.entry)
  ) {
    return events;
  }
  for (const entry of root.entry) {
    const changes = record(entry)?.changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const value = record(record(change)?.value);
      const phoneNumberId = record(value?.metadata)?.phone_number_id;
      if (!value || typeof phoneNumberId !== "string") continue;
      for (const status of Array.isArray(value.statuses)
        ? value.statuses
        : []) {
        const item = record(status);
        if (
          !item ||
          typeof item.id !== "string" ||
          (item.status !== "delivered" &&
            item.status !== "read" &&
            item.status !== "failed")
        ) {
          continue;
        }
        const failure = Array.isArray(item.errors)
          ? record(item.errors[0])
          : null;
        events.push({
          error: failure
            ? `${String(failure.code ?? "")}: ${String(failure.title ?? "")}`.slice(
                0,
                200
              )
            : null,
          eventKey: `status:${item.id}:${item.status}`,
          kind: "status",
          phoneNumberId,
          providerMessageId: item.id,
          status: item.status
        });
      }
      for (const message of Array.isArray(value.messages)
        ? value.messages
        : []) {
        const item = record(message);
        const text = record(item?.text)?.body;
        if (
          !item ||
          typeof item.id !== "string" ||
          typeof item.from !== "string" ||
          !/^[1-9][0-9]{7,14}$/u.test(item.from) ||
          typeof text !== "string"
        ) {
          continue;
        }
        events.push({
          eventKey: `message:${item.id}`,
          from: `+${item.from}`,
          kind: "message",
          phoneNumberId,
          text: text.slice(0, 200)
        });
      }
    }
  }
  return events;
}

/** "BAJA" (or "STOP"), whatever the case, accents or punctuation around it. */
export function isOptOutText(text: string): boolean {
  const normalized = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/gu, "")
    .toUpperCase()
    .replace(/[^A-Z]/gu, "");
  return normalized === "BAJA" || normalized === "STOP";
}
