import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual
} from "node:crypto";

import type {
  DinerConsentRequest,
  DinerExport,
  DinerProfileView,
  DinerSessionLinkResult,
  SaveDinerProfileRequest,
  TenantScope
} from "@platform/contracts";
import type { DinerIdentityRepository } from "@platform/database";

import type { GoogleOidcGateway } from "./google-oidc.gateway.js";

export class DinerAuthUnavailableError extends Error {}
export class DinerLoginInvalidError extends Error {}
export class DinerSessionInvalidError extends Error {}

export type DinerIdentityOptions = {
  /** Where the diner is sent back: https in production, http for local hosts. */
  scheme: "http" | "https";
  stateSecret: string;
  subPepper: string;
};

type LoginState = {
  /** Binding hash: the secret the browser keeps in its cookie, hashed. */
  b: string;
  /** Expiry, epoch milliseconds. */
  e: number;
  /** The restaurant host that started the login. */
  h: string;
  /** Where to land afterwards. */
  r: string;
  /** The restaurant, resolved from that host. */
  t: string;
};

const stateLifetimeMs = 10 * 60_000;
/** A plain host name with an optional port: the only thing the diner is sent back to. */
const hostPattern = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{1,5})?$/u;
const secretPattern = /^[A-Za-z0-9_-]{43}$/u;

function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/**
 * Optional diner accounts. The restaurant comes from the host, the account from a
 * session this service issues, and the Google identity only ever reaches the
 * platform account table: profiles, consents and links carry opaque ids.
 */
export class DinerIdentityService {
  constructor(
    private readonly diners: DinerIdentityRepository,
    private readonly google: GoogleOidcGateway | null,
    private readonly options: DinerIdentityOptions
  ) {}

  /** Signs the state that rides through Google and returns where to send the diner. */
  start(input: {
    bindingHash: string;
    host: string;
    returnPath: string;
    tenantId: string;
  }): Promise<string> {
    if (!this.google) return Promise.reject(new DinerAuthUnavailableError());
    const host = input.host.toLowerCase();
    if (!hostPattern.test(host))
      return Promise.reject(new DinerLoginInvalidError());
    const state: LoginState = {
      b: input.bindingHash,
      e: Date.now() + stateLifetimeMs,
      h: host,
      r: input.returnPath,
      t: input.tenantId
    };
    const payload = Buffer.from(JSON.stringify(state)).toString("base64url");
    return Promise.resolve(
      this.google.authorizeUrl(`${payload}.${this.sign(payload)}`)
    );
  }

  /**
   * Google came back. Creates (or finds) the account and a one-time code bound to
   * the browser that started the login, and returns the restaurant URL to continue.
   */
  async complete(input: { code: string; state: string }): Promise<string> {
    if (!this.google) throw new DinerAuthUnavailableError();
    const state = this.verify(input.state);
    let identity;
    try {
      identity = await this.google.exchange(input.code);
    } catch {
      throw new DinerLoginInvalidError();
    }
    if (!identity.emailVerified) throw new DinerLoginInvalidError();
    const accountId = await this.diners.upsertAccount({
      email: identity.email,
      subHash: createHmac("sha256", this.options.subPepper)
        .update(`google:${identity.sub}`)
        .digest("hex")
    });
    const code = randomBytes(32).toString("base64url");
    await this.diners.createLoginExchange({
      accountId,
      codeHash: sha256(`${code}:${state.b}`),
      tenantId: state.t
    });
    const target = new URL(`${this.options.scheme}://${state.h}`);
    target.pathname = "/api/diner/complete";
    target.searchParams.set("code", code);
    target.searchParams.set("next", state.r);
    return target.toString();
  }

  /** The diner refused Google's screen: back to where they were, without a session. */
  async cancel(rawState: string): Promise<string> {
    const state = this.verify(rawState);
    return new URL(state.r, `${this.options.scheme}://${state.h}`).toString();
  }

  /** Swaps the one-time code (plus the browser's own secret) for a session token. */
  async redeem(input: {
    binding: string;
    code: string;
    tenantId: string;
  }): Promise<string> {
    const token = randomBytes(32).toString("base64url");
    const accountId = await this.diners.redeemLogin({
      codeHash: sha256(
        `${input.code}:${sha256(input.binding).toString("hex")}`
      ),
      sessionHash: sha256(token),
      tenantId: input.tenantId
    });
    if (!accountId) throw new DinerLoginInvalidError();
    return token;
  }

  async authenticate(
    tenantId: string,
    token: string | undefined
  ): Promise<string> {
    if (!token || !secretPattern.test(token)) {
      throw new DinerSessionInvalidError();
    }
    const accountId = await this.diners.resolveSession({
      tenantId,
      tokenHash: sha256(token)
    });
    if (!accountId) throw new DinerSessionInvalidError();
    return accountId;
  }

  logout(tenantId: string, token: string): Promise<void> {
    return this.diners.revokeSession({ tenantId, tokenHash: sha256(token) });
  }

  getProfile(tenantId: string, accountId: string): Promise<DinerProfileView> {
    return this.diners.getProfile({ accountId, tenantId });
  }

  saveProfile(
    tenantId: string,
    accountId: string,
    request: SaveDinerProfileRequest
  ): Promise<DinerProfileView> {
    return this.diners.saveProfile({ accountId, request, tenantId });
  }

  recordConsent(
    tenantId: string,
    accountId: string,
    request: DinerConsentRequest
  ): Promise<DinerProfileView> {
    return this.diners.recordConsent({ accountId, request, tenantId });
  }

  linkToSession(
    scope: TenantScope,
    accountId: string,
    token: string
  ): Promise<DinerSessionLinkResult> {
    return this.diners.linkToSession({ accountId, scope, token });
  }

  export(accountId: string): Promise<DinerExport> {
    return this.diners.export(accountId);
  }

  async anonymize(accountId: string): Promise<void> {
    await this.diners.anonymize(accountId);
  }

  private sign(payload: string): string {
    return createHmac("sha256", this.options.stateSecret)
      .update(payload)
      .digest("base64url");
  }

  private verify(raw: string): LoginState {
    const [payload, signature, extra] = raw.split(".");
    if (!payload || !signature || extra !== undefined) {
      throw new DinerLoginInvalidError();
    }
    const expected = Buffer.from(this.sign(payload));
    const received = Buffer.from(signature);
    if (
      expected.length !== received.length ||
      !timingSafeEqual(expected, received)
    ) {
      throw new DinerLoginInvalidError();
    }
    let state: LoginState;
    try {
      state = JSON.parse(
        Buffer.from(payload, "base64url").toString("utf8")
      ) as LoginState;
    } catch {
      throw new DinerLoginInvalidError();
    }
    if (
      typeof state.e !== "number" ||
      state.e <= Date.now() ||
      typeof state.t !== "string" ||
      typeof state.h !== "string" ||
      !hostPattern.test(state.h) ||
      typeof state.r !== "string" ||
      typeof state.b !== "string"
    ) {
      throw new DinerLoginInvalidError();
    }
    return state;
  }
}
