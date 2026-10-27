import { describe, expect, it } from "vitest";

import { applicationServerKey, subscriptionRequest } from "./push-client";

describe("push client", () => {
  it("turns a VAPID public key into the bytes the browser expects", () => {
    // 65 bytes: 0x04 followed by 64 more.
    const bytes = Uint8Array.from([
      4,
      ...Array.from({ length: 64 }, (_, n) => n)
    ]);
    const key = Buffer.from(bytes).toString("base64url");
    expect(Array.from(applicationServerKey(key))).toEqual(Array.from(bytes));
    expect(applicationServerKey(key)).toHaveLength(65);
  });

  it("keeps only what the server needs from a browser subscription", () => {
    expect(
      subscriptionRequest({
        endpoint: "https://push.example.com/x",
        expirationTime: null,
        keys: { auth: "auth", p256dh: "key" }
      })
    ).toEqual({
      auth: "auth",
      endpoint: "https://push.example.com/x",
      p256dh: "key"
    });
    expect(
      subscriptionRequest({ endpoint: "https://push.example.com/x" })
    ).toBeNull();
    expect(
      subscriptionRequest({ keys: { auth: "a", p256dh: "b" } })
    ).toBeNull();
  });
});
