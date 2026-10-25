import { describe, expect, it } from "vitest";

import {
  SIGNATURE_TOLERANCE_SECONDS,
  signatureHeader,
  signatureManifest,
  signManifest,
  verifyWebhookSignature
} from "./webhook-signature.js";

const secret = "webhook-secret-123456";
const now = new Date("2026-10-25T12:00:00.000Z");
const ts = String(Math.floor(now.getTime() / 1000));
const parts = { dataId: "5550001", requestId: "req-1", ts };

function verify(
  overrides: Partial<Parameters<typeof verifyWebhookSignature>[0]> = {}
) {
  return verifyWebhookSignature({
    dataId: parts.dataId,
    header: signatureHeader(secret, parts),
    now: () => now,
    requestId: parts.requestId,
    secret,
    ...overrides
  });
}

describe("Mercado Pago webhook signature", () => {
  it("builds the documented manifest", () => {
    expect(signatureManifest(parts)).toBe(
      `id:5550001;request-id:req-1;ts:${ts};`
    );
    expect(signatureManifest({ ...parts, requestId: null })).toBe(
      `id:5550001;ts:${ts};`
    );
    expect(signatureManifest({ ...parts, dataId: "ABC123" })).toContain(
      "id:abc123;"
    );
    expect(signatureManifest({ ...parts, dataId: "A-B_c" })).toContain(
      "id:A-B_c;"
    );
  });

  it("accepts a signature made with the secret", () => {
    expect(verify()).toBe(true);
    expect(
      verify({
        dataId: "5550001",
        header: signatureHeader(secret, { ...parts, requestId: null }),
        requestId: undefined
      })
    ).toBe(true);
  });

  it("refuses a missing, malformed or tampered signature", () => {
    expect(verify({ header: undefined })).toBe(false);
    expect(verify({ header: "" })).toBe(false);
    expect(verify({ header: "nonsense" })).toBe(false);
    expect(verify({ header: `ts=${ts}` })).toBe(false);
    expect(verify({ header: `ts=${ts},v1=zz` })).toBe(false);
    expect(verify({ dataId: null })).toBe(false);
    // Another payment, another request id, another secret: all invalid.
    expect(verify({ dataId: "5550002" })).toBe(false);
    expect(verify({ requestId: "req-2" })).toBe(false);
    expect(verify({ secret: "another-secret-123456" })).toBe(false);
    expect(
      verify({
        header: `ts=${ts},v1=${signManifest(secret, "id:1;ts:1;")}`
      })
    ).toBe(false);
  });

  it("refuses a timestamp that was altered after signing", () => {
    const original = signatureHeader(secret, parts);
    const altered = original.replace(`ts=${ts}`, `ts=${Number(ts) + 1}`);
    expect(verify({ header: altered })).toBe(false);
  });

  it("limits how old or how new a signature may be", () => {
    const old = String(Number(ts) - SIGNATURE_TOLERANCE_SECONDS - 1);
    expect(
      verify({ header: signatureHeader(secret, { ...parts, ts: old }) })
    ).toBe(false);
    const edge = String(Number(ts) - SIGNATURE_TOLERANCE_SECONDS);
    expect(
      verify({ header: signatureHeader(secret, { ...parts, ts: edge }) })
    ).toBe(true);
    const future = String(Number(ts) + SIGNATURE_TOLERANCE_SECONDS + 1);
    expect(
      verify({ header: signatureHeader(secret, { ...parts, ts: future }) })
    ).toBe(false);
  });

  it("tolerates a millisecond timestamp", () => {
    const milliseconds = String(now.getTime());
    expect(
      verify({
        header: signatureHeader(secret, { ...parts, ts: milliseconds })
      })
    ).toBe(true);
  });

  it("takes the first value when a key repeats", () => {
    const header = signatureHeader(secret, parts);
    expect(verify({ header: `${header},v1=${"0".repeat(64)}` })).toBe(true);
    expect(verify({ header: `v1=${"0".repeat(64)},${header}` })).toBe(false);
  });
});
