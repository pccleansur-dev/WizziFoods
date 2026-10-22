import { createHash, randomBytes } from "node:crypto";

import { UnauthorizedException } from "@nestjs/common";
import {
  STAFF_ROLE_CAPABILITIES,
  staffSessionExpiresAt,
  type StaffCurrentSessionView,
  type StaffLoginRequest,
  type StaffRevalidationRequest,
  type StaffSessionView
} from "@platform/contracts";
import type { StaffAuthRepository } from "@platform/database";

import { hashStaffPin, verifyStaffPin } from "./pin-credential.js";

type Clock = () => Date;
type TokenGenerator = () => string;

const defaultClock: Clock = () => new Date();
const defaultTokenGenerator: TokenGenerator = () =>
  randomBytes(32).toString("base64url");

function invalidStaffAccess(): UnauthorizedException {
  return new UnauthorizedException({
    error: {
      code: "STAFF_AUTH_FAILED",
      message:
        "No pudimos verificar el usuario y PIN, o el acceso está bloqueado temporalmente."
    }
  });
}

function invalidStaffSession(): UnauthorizedException {
  return new UnauthorizedException({
    error: {
      code: "STAFF_SESSION_INVALID",
      message: "La sesión del personal venció o ya no está disponible."
    }
  });
}

function hashAccessToken(accessToken: string): string {
  return createHash("sha256").update(accessToken).digest("hex");
}

export class StaffAuthService {
  private readonly dummyCredential: Promise<string>;

  constructor(
    private readonly repository: StaffAuthRepository,
    private readonly pepper: string,
    private readonly clock: Clock = defaultClock,
    private readonly tokenGenerator: TokenGenerator = defaultTokenGenerator
  ) {
    this.dummyCredential = hashStaffPin("000000", pepper);
  }

  async signIn(
    tenantSlug: string,
    request: StaffLoginRequest
  ): Promise<StaffSessionView> {
    const now = this.clock();
    const expiresAt = staffSessionExpiresAt(now);
    const accessToken = this.tokenGenerator();
    const tokenHash = hashAccessToken(accessToken);
    const result = await this.repository.authenticate({
      expiresAt,
      now,
      tenantSlug,
      tokenHash,
      username: request.username,
      verifyPin: async (storedCredential) =>
        verifyStaffPin(
          request.pin,
          storedCredential ?? (await this.dummyCredential),
          this.pepper
        )
    });

    if (result.result !== "authenticated") {
      throw invalidStaffAccess();
    }

    return {
      accessToken,
      expiresAt: expiresAt.toISOString(),
      identity: {
        ...result.identity,
        staff: {
          ...result.identity.staff,
          capabilities: STAFF_ROLE_CAPABILITIES[result.identity.staff.role]
        }
      },
      lastRevalidatedAt: now.toISOString()
    };
  }

  async currentSession(accessToken: string): Promise<StaffCurrentSessionView> {
    const session = await this.repository.resolveSession(
      hashAccessToken(accessToken),
      this.clock()
    );
    if (!session) {
      throw invalidStaffSession();
    }

    return {
      expiresAt: session.expiresAt.toISOString(),
      identity: {
        ...session.identity,
        staff: {
          ...session.identity.staff,
          capabilities: STAFF_ROLE_CAPABILITIES[session.identity.staff.role]
        }
      },
      lastRevalidatedAt: session.lastRevalidatedAt.toISOString()
    };
  }

  async revalidate(
    accessToken: string,
    request: StaffRevalidationRequest
  ): Promise<{ revalidatedAt: string }> {
    const result = await this.repository.revalidate({
      now: this.clock(),
      tokenHash: hashAccessToken(accessToken),
      verifyPin: async (storedCredential) =>
        verifyStaffPin(
          request.pin,
          storedCredential ?? (await this.dummyCredential),
          this.pepper
        )
    });
    if (result.result !== "revalidated") {
      throw invalidStaffAccess();
    }
    return { revalidatedAt: result.revalidatedAt.toISOString() };
  }

  async signOut(accessToken: string): Promise<void> {
    await this.repository.revokeSession(
      hashAccessToken(accessToken),
      this.clock()
    );
  }
}
