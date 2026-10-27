import { ServiceUnavailableException } from "@nestjs/common";
import {
  tenantRealtimeChannel,
  type StaffCapability,
  type TenantScope
} from "@platform/contracts";
import { SignJWT } from "jose";

/** Ten minutes: long enough not to chatter, short enough that a revoked staff member fades. */
export const REALTIME_TOKEN_SECONDS = 10 * 60;

export type RealtimeGrant = {
  channels: string[];
  expiresAt: string;
  token: string;
};

type Who = {
  capabilities: readonly StaffCapability[];
  scope: TenantScope;
  staffId: string;
};

const salonCapabilities: readonly StaffCapability[] = [
  "calls.manage",
  "orders.manage",
  "orders.validate",
  "payments.collect",
  "salon.manage",
  "tables.serve"
];

/**
 * The channels a staff member may hear, from what their role can do: the salon for who
 * serves or charges, the register for who approves operations, and one production
 * channel per sector kind they work. A channel only says "something changed"; the data is
 * always fetched from the API with the staff member's own session.
 */
export function staffRealtimeChannels(who: Omit<Who, "staffId">): string[] {
  const topics: string[] = [];
  if (salonCapabilities.some((c) => who.capabilities.includes(c))) {
    topics.push("salon");
  }
  if (who.capabilities.includes("operations.approve")) topics.push("cash");
  if (who.capabilities.includes("production.kitchen.manage")) {
    topics.push("production-kitchen");
  }
  if (who.capabilities.includes("production.bar.manage")) {
    topics.push("production-bar");
  }
  return topics.map((topic) => tenantRealtimeChannel(who.scope, topic));
}

/**
 * Signs the short-lived token the browser hands to Supabase Realtime. The database policy
 * on `realtime.messages` lets a token listen to exactly the channels in its `channels`
 * claim, so what is signed here is the whole authorization. Without the secret the
 * feature is simply off and the screens keep polling.
 */
export class RealtimeTokenService {
  private readonly key: Uint8Array | null;

  constructor(
    secret: string | null,
    private readonly now: () => Date = () => new Date()
  ) {
    this.key = secret ? new TextEncoder().encode(secret) : null;
  }

  get enabled(): boolean {
    return this.key !== null;
  }

  async issue(who: Who): Promise<RealtimeGrant> {
    if (!this.key) {
      throw new ServiceUnavailableException({
        error: {
          code: "REALTIME_NOT_AVAILABLE",
          message: "La actualización en vivo no está disponible."
        }
      });
    }
    const channels = staffRealtimeChannels(who);
    const issuedAt = Math.floor(this.now().getTime() / 1000);
    const expiresAt = issuedAt + REALTIME_TOKEN_SECONDS;
    const token = await new SignJWT({
      channels,
      location_id: who.scope.locationId,
      role: "authenticated",
      tenant_id: who.scope.tenantId
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setAudience("authenticated")
      .setSubject(who.staffId)
      .setIssuedAt(issuedAt)
      .setExpirationTime(expiresAt)
      .sign(this.key);
    return {
      channels,
      expiresAt: new Date(expiresAt * 1000).toISOString(),
      token
    };
  }
}
