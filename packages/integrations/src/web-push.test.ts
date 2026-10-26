import { createECDH, createPublicKey, verify } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  SimulatedWebPushProvider,
  VapidWebPushProvider,
  encryptWebPushPayload,
  vapidAuthorization,
  type VapidKeys
} from "./web-push.js";

const b64 = (value: string) => Buffer.from(value, "base64url");

function newKeys(): VapidKeys {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    privateKey: ecdh.getPrivateKey().toString("base64url"),
    publicKey: ecdh.getPublicKey().toString("base64url"),
    subject: "mailto:soporte@plataforma.test"
  };
}

function subscription(endpoint = "https://push.example.com/send/abc") {
  const browser = createECDH("prime256v1");
  browser.generateKeys();
  return {
    browser,
    value: {
      auth: Buffer.alloc(16, 7).toString("base64url"),
      endpoint,
      p256dh: browser.getPublicKey().toString("base64url")
    }
  };
}

describe("Web Push encryption (RFC 8291)", () => {
  it("reproduces the example of the RFC byte for byte", () => {
    const body = encryptWebPushPayload({
      authSecret: b64("BTBZMqHH6r4Tts7J_aSIgg"),
      ephemeralPrivateKey: b64("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"),
      payload: Buffer.from("When I grow up, I want to be a watermelon"),
      salt: b64("DGv6ra1nlYgDCS1FRnbzlw"),
      userPublicKey: b64(
        "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4"
      )
    });
    expect(body.toString("base64url")).toBe(
      "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN"
    );
  });

  it("refuses a malformed browser key or auth secret", () => {
    const { value } = subscription();
    expect(() =>
      encryptWebPushPayload({
        authSecret: b64(value.auth),
        payload: Buffer.from("x"),
        userPublicKey: Buffer.alloc(65, 1)
      })
    ).toThrow();
    expect(() =>
      encryptWebPushPayload({
        authSecret: Buffer.alloc(3),
        payload: Buffer.from("x"),
        userPublicKey: b64(value.p256dh)
      })
    ).toThrow();
  });
});

describe("VAPID", () => {
  it("signs a JWT the public key can verify, for the push service's own origin", () => {
    const keys = newKeys();
    const header = vapidAuthorization(
      keys,
      "https://push.example.com",
      new Date("2026-10-26T12:00:00Z")
    );
    const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/u.exec(header);
    expect(match?.[4]).toBe(keys.publicKey);
    const claims = JSON.parse(
      Buffer.from(match![2]!, "base64url").toString("utf8")
    );
    expect(claims).toMatchObject({
      aud: "https://push.example.com",
      sub: "mailto:soporte@plataforma.test"
    });
    expect(claims.exp).toBe(
      Math.floor(new Date("2026-10-26T12:00:00Z").getTime() / 1000) + 43_200
    );
    const publicBytes = b64(keys.publicKey);
    const publicKey = createPublicKey({
      format: "jwk",
      key: {
        crv: "P-256",
        kty: "EC",
        x: publicBytes.subarray(1, 33).toString("base64url"),
        y: publicBytes.subarray(33).toString("base64url")
      }
    });
    expect(
      verify(
        "sha256",
        Buffer.from(`${match![1]}.${match![2]}`),
        { dsaEncoding: "ieee-p1363", key: publicKey },
        Buffer.from(match![3]!, "base64url")
      )
    ).toBe(true);
  });
});

describe("VapidWebPushProvider", () => {
  const answer = (status: number) => () =>
    Promise.resolve(new Response(null, { status }));

  it("posts an encrypted body with VAPID and answers sent for 201", async () => {
    const keys = newKeys();
    const { value } = subscription();
    let seen: { body: Uint8Array; headers: Headers; url: string } | null = null;
    const provider = new VapidWebPushProvider(keys, {
      fetch: (url, init) => {
        seen = {
          body: init.body as Uint8Array,
          headers: new Headers(init.headers),
          url
        };
        return answer(201)();
      }
    });
    await expect(
      provider.send({ payload: '{"title":"Hola"}', subscription: value })
    ).resolves.toEqual({ status: "sent" });
    expect(seen!.url).toBe(value.endpoint);
    expect(seen!.headers.get("content-encoding")).toBe("aes128gcm");
    expect(seen!.headers.get("authorization")).toMatch(/^vapid t=/u);
    expect(seen!.headers.get("ttl")).toBe("86400");
    expect(Buffer.from(seen!.body).includes(Buffer.from("Hola"))).toBe(false);
  });

  it("tells a removed browser from a temporary failure from a permanent one", async () => {
    const { value } = subscription();
    const make = (status: number) =>
      new VapidWebPushProvider(newKeys(), { fetch: answer(status) });
    await expect(
      make(410).send({ payload: "{}", subscription: value })
    ).resolves.toEqual({ status: "gone" });
    await expect(
      make(404).send({ payload: "{}", subscription: value })
    ).resolves.toEqual({ status: "gone" });
    await expect(
      make(429).send({ payload: "{}", subscription: value })
    ).resolves.toMatchObject({ status: "transient_failure" });
    await expect(
      make(503).send({ payload: "{}", subscription: value })
    ).resolves.toMatchObject({ status: "transient_failure" });
    await expect(
      make(403).send({ payload: "{}", subscription: value })
    ).resolves.toMatchObject({
      error: "push_service_403",
      status: "permanent_failure"
    });
    const offline = new VapidWebPushProvider(newKeys(), {
      fetch: () => Promise.reject(new Error("boom"))
    });
    await expect(
      offline.send({ payload: "{}", subscription: value })
    ).resolves.toEqual({ error: "network_error", status: "transient_failure" });
  });

  it("never posts to an insecure or malformed subscription", async () => {
    let called = false;
    const provider = new VapidWebPushProvider(newKeys(), {
      fetch: () => {
        called = true;
        return answer(201)();
      }
    });
    const { value } = subscription("http://push.example.com/insecure");
    await expect(
      provider.send({ payload: "{}", subscription: value })
    ).resolves.toMatchObject({ status: "permanent_failure" });
    await expect(
      provider.send({
        payload: "{}",
        subscription: { ...subscription().value, p256dh: "bad" }
      })
    ).resolves.toMatchObject({ status: "permanent_failure" });
    expect(called).toBe(false);
  });

  it("refuses badly sized keys", () => {
    expect(
      () => new VapidWebPushProvider({ ...newKeys(), privateKey: "AAAA" })
    ).toThrow();
  });
});

describe("SimulatedWebPushProvider", () => {
  it("is refused in production and records what it sends", async () => {
    expect(() => new SimulatedWebPushProvider("production")).toThrow(
      "not allowed in production"
    );
    const provider = new SimulatedWebPushProvider();
    const { value } = subscription();
    provider.failNext("transient_failure");
    expect(
      (await provider.send({ payload: "{}", subscription: value })).status
    ).toBe("transient_failure");
    expect(await provider.send({ payload: "{}", subscription: value })).toEqual(
      { status: "sent" }
    );
    provider.goneEndpoints.add(value.endpoint);
    expect(await provider.send({ payload: "{}", subscription: value })).toEqual(
      { status: "gone" }
    );
    expect(provider.sent).toHaveLength(1);
  });
});
