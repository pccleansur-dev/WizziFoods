import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Mercado Pago signs `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` with the
 * application's secret (HMAC-SHA256, hex) and sends it as `ts=...,v1=...`. The body
 * is not signed, which is one more reason the handler never trusts it: it only learns
 * which payment changed and then asks Mercado Pago for the real state.
 */

/** Retries arrive hours later, so the window is wide; replays are harmless anyway. */
export const SIGNATURE_TOLERANCE_SECONDS = 24 * 60 * 60;

export type SignatureParts = {
  dataId: string;
  requestId: string | null;
  ts: string;
};

export function signatureManifest(parts: SignatureParts): string {
  // Alphanumeric ids are compared lowercased, as the provider documents.
  const id = /^[a-z0-9]+$/iu.test(parts.dataId)
    ? parts.dataId.toLowerCase()
    : parts.dataId;
  return `id:${id};${parts.requestId ? `request-id:${parts.requestId};` : ""}ts:${parts.ts};`;
}

export function signManifest(secret: string, manifest: string): string {
  return createHmac("sha256", secret).update(manifest).digest("hex");
}

/** The header a sender produces; used by the sandbox and by tests. */
export function signatureHeader(secret: string, parts: SignatureParts): string {
  return `ts=${parts.ts},v1=${signManifest(secret, signatureManifest(parts))}`;
}

function readHeader(header: string): { ts: string; v1: string } | null {
  let ts: string | null = null;
  let v1: string | null = null;
  for (const piece of header.split(",")) {
    const separator = piece.indexOf("=");
    if (separator < 1) continue;
    const key = piece.slice(0, separator).trim();
    const value = piece.slice(separator + 1).trim();
    if (key === "ts" && ts === null) ts = value;
    if (key === "v1" && v1 === null) v1 = value;
  }
  return ts !== null && v1 !== null ? { ts, v1 } : null;
}

export function verifyWebhookSignature(input: {
  dataId: string | null;
  header: string | null | undefined;
  now?: (() => Date) | undefined;
  requestId: string | null | undefined;
  secret: string;
}): boolean {
  if (!input.header || !input.dataId) return false;
  const parts = readHeader(input.header);
  if (
    !parts ||
    !/^[0-9]{9,13}$/u.test(parts.ts) ||
    !/^[0-9a-f]{64}$/u.test(parts.v1)
  ) {
    return false;
  }
  // The timestamp is seconds, but a millisecond one is tolerated.
  const sentSeconds =
    parts.ts.length > 11
      ? Math.floor(Number(parts.ts) / 1000)
      : Number(parts.ts);
  const nowSeconds = Math.floor((input.now?.() ?? new Date()).getTime() / 1000);
  if (Math.abs(nowSeconds - sentSeconds) > SIGNATURE_TOLERANCE_SECONDS) {
    return false;
  }
  const expected = Buffer.from(
    signManifest(
      input.secret,
      signatureManifest({
        dataId: input.dataId,
        requestId: input.requestId?.trim() || null,
        ts: parts.ts
      })
    ),
    "hex"
  );
  const received = Buffer.from(parts.v1, "hex");
  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  );
}
