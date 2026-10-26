import {
  createECDH,
  createPrivateKey,
  createCipheriv,
  hkdfSync,
  randomBytes,
  sign
} from "node:crypto";

export type WebPushSubscription = {
  /** base64url, 16 bytes. */
  auth: string;
  endpoint: string;
  /** base64url, the browser's uncompressed P-256 public key (65 bytes). */
  p256dh: string;
};

/**
 * "gone" means the push service no longer knows the endpoint (404/410): the
 * subscription must be dropped. "permanent_failure" will not work by retrying (a
 * rejected VAPID key, a payload too big); "transient_failure" may.
 */
export type WebPushResult =
  | { status: "gone" }
  | { error: string; status: "permanent_failure" | "transient_failure" }
  | { status: "sent" };

export type SendWebPushInput = {
  /** The text of the notification, already a JSON string. */
  payload: string;
  subscription: WebPushSubscription;
  ttlSeconds?: number;
  urgency?: "high" | "low" | "normal" | "very-low";
};

export interface WebPushProvider {
  send(input: SendWebPushInput): Promise<WebPushResult>;
}

const recordSize = 4096;

function fromBase64Url(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

function toBase64Url(value: Buffer): string {
  return value.toString("base64url");
}

/**
 * RFC 8291 (message encryption for Web Push) with the aes128gcm content coding of
 * RFC 8188, in a single record. The ephemeral key and the salt can be fixed only to
 * reproduce the RFC's own test vector.
 */
export function encryptWebPushPayload(input: {
  authSecret: Buffer;
  ephemeralPrivateKey?: Buffer;
  payload: Buffer;
  salt?: Buffer;
  userPublicKey: Buffer;
}): Buffer {
  if (input.userPublicKey.length !== 65 || input.userPublicKey[0] !== 4) {
    throw new Error("the browser key must be an uncompressed P-256 point");
  }
  if (input.authSecret.length !== 16) {
    throw new Error("the auth secret must be 16 bytes");
  }
  if (input.payload.length > recordSize - 17) {
    throw new Error("the payload does not fit in one record");
  }
  const server = createECDH("prime256v1");
  if (input.ephemeralPrivateKey) {
    server.setPrivateKey(input.ephemeralPrivateKey);
  } else {
    server.generateKeys();
  }
  const serverPublic = server.getPublicKey();
  const shared = server.computeSecret(input.userPublicKey);
  const salt = input.salt ?? randomBytes(16);

  const keyInfo = Buffer.concat([
    Buffer.from("WebPush: info\0", "utf8"),
    input.userPublicKey,
    serverPublic
  ]);
  const inputKey = Buffer.from(
    hkdfSync("sha256", shared, input.authSecret, keyInfo, 32)
  );
  const contentKey = Buffer.from(
    hkdfSync(
      "sha256",
      inputKey,
      salt,
      Buffer.from("Content-Encoding: aes128gcm\0", "utf8"),
      16
    )
  );
  const nonce = Buffer.from(
    hkdfSync(
      "sha256",
      inputKey,
      salt,
      Buffer.from("Content-Encoding: nonce\0", "utf8"),
      12
    )
  );

  const cipher = createCipheriv("aes-128-gcm", contentKey, nonce);
  // 0x02 closes the last (and only) record.
  const body = Buffer.concat([
    cipher.update(Buffer.concat([input.payload, Buffer.from([2])])),
    cipher.final(),
    cipher.getAuthTag()
  ]);
  const header = Buffer.alloc(16 + 4 + 1);
  salt.copy(header, 0);
  header.writeUInt32BE(recordSize, 16);
  header.writeUInt8(serverPublic.length, 20);
  return Buffer.concat([header, serverPublic, body]);
}

export type VapidKeys = {
  /** base64url, 65 bytes. Also the key the browser subscribes with. */
  publicKey: string;
  /** base64url, 32 bytes. Never leaves the server that sends. */
  privateKey: string;
  /** `mailto:` or `https:` contact for the push services. */
  subject: string;
};

/** The JWT the push service checks to know who is sending (RFC 8292). */
export function vapidAuthorization(
  keys: VapidKeys,
  audience: string,
  now: Date = new Date()
): string {
  const publicKey = fromBase64Url(keys.publicKey);
  const key = createPrivateKey({
    format: "jwk",
    key: {
      crv: "P-256",
      d: keys.privateKey,
      kty: "EC",
      x: toBase64Url(publicKey.subarray(1, 33)),
      y: toBase64Url(publicKey.subarray(33, 65))
    }
  });
  const encode = (value: unknown) =>
    toBase64Url(Buffer.from(JSON.stringify(value), "utf8"));
  const signingInput = `${encode({ alg: "ES256", typ: "JWT" })}.${encode({
    aud: audience,
    exp: Math.floor(now.getTime() / 1000) + 12 * 60 * 60,
    sub: keys.subject
  })}`;
  const signature = sign("sha256", Buffer.from(signingInput), {
    dsaEncoding: "ieee-p1363",
    key
  });
  return `vapid t=${signingInput}.${toBase64Url(signature)}, k=${keys.publicKey}`;
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type VapidWebPushOptions = {
  fetch?: FetchLike;
  timeoutMs?: number;
};

/** Delivers to the push service of each browser (FCM, Mozilla, Apple) with VAPID. */
export class VapidWebPushProvider implements WebPushProvider {
  private readonly fetcher: FetchLike;
  private readonly timeoutMs: number;

  constructor(
    private readonly keys: VapidKeys,
    options: VapidWebPushOptions = {}
  ) {
    this.fetcher = options.fetch ?? ((url, init) => fetch(url, init));
    this.timeoutMs = options.timeoutMs ?? 15_000;
    if (fromBase64Url(keys.publicKey).length !== 65) {
      throw new Error("the VAPID public key must be 65 bytes");
    }
    if (fromBase64Url(keys.privateKey).length !== 32) {
      throw new Error("the VAPID private key must be 32 bytes");
    }
  }

  async send(input: SendWebPushInput): Promise<WebPushResult> {
    let endpoint: URL;
    let body: Buffer;
    let authorization: string;
    try {
      endpoint = new URL(input.subscription.endpoint);
      if (endpoint.protocol !== "https:") throw new Error("not https");
      body = encryptWebPushPayload({
        authSecret: fromBase64Url(input.subscription.auth),
        payload: Buffer.from(input.payload, "utf8"),
        userPublicKey: fromBase64Url(input.subscription.p256dh)
      });
      authorization = vapidAuthorization(this.keys, endpoint.origin);
    } catch {
      // A subscription we cannot even build a request for will never work.
      return { error: "invalid_subscription", status: "permanent_failure" };
    }
    let response: Response;
    try {
      response = await this.fetcher(endpoint.toString(), {
        body: new Uint8Array(body),
        headers: {
          authorization,
          "content-encoding": "aes128gcm",
          "content-type": "application/octet-stream",
          ttl: String(input.ttlSeconds ?? 24 * 60 * 60),
          urgency: input.urgency ?? "normal"
        },
        method: "POST",
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch {
      return { error: "network_error", status: "transient_failure" };
    }
    if (response.status >= 200 && response.status < 300) {
      return { status: "sent" };
    }
    if (response.status === 404 || response.status === 410) {
      return { status: "gone" };
    }
    const transient = response.status === 429 || response.status >= 500;
    return {
      error: `push_service_${response.status}`,
      status: transient ? "transient_failure" : "permanent_failure"
    };
  }
}

/** Records what it was asked to send; nothing leaves the process. Never in production. */
export class SimulatedWebPushProvider implements WebPushProvider {
  readonly sent: SendWebPushInput[] = [];
  /** Endpoints that answer "gone", as a push service does for a removed browser. */
  readonly goneEndpoints = new Set<string>();
  private failures: Array<"permanent_failure" | "transient_failure"> = [];

  constructor(environment = "development") {
    if (environment === "production") {
      throw new Error(
        "The simulated Web Push provider is not allowed in production"
      );
    }
  }

  failNext(status: "permanent_failure" | "transient_failure", count = 1): void {
    for (let n = 0; n < count; n += 1) this.failures.push(status);
  }

  send(input: SendWebPushInput): Promise<WebPushResult> {
    if (this.goneEndpoints.has(input.subscription.endpoint)) {
      return Promise.resolve({ status: "gone" });
    }
    const failure = this.failures.shift();
    if (failure) {
      return Promise.resolve({
        error: `simulated_${failure}`,
        status: failure
      });
    }
    this.sent.push(input);
    return Promise.resolve({ status: "sent" });
  }
}
