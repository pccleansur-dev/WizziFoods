import { ServiceUnavailableException } from "@nestjs/common";
import { STAFF_ROLE_CAPABILITIES } from "@platform/contracts";
import { jwtVerify } from "jose";
import { describe, expect, it } from "vitest";

import { RealtimeController } from "./realtime.controller.js";
import {
  REALTIME_TOKEN_SECONDS,
  RealtimeTokenService,
  staffRealtimeChannels
} from "./realtime-token.service.js";

const tenantId = "3e200000-0000-4000-8000-000000000001";
const locationId = "3e200000-0000-4000-8000-000000000002";
const scope = { locationId, tenantId };
const secret = "a-jwt-secret-with-at-least-32-characters!";
const prefix = `tenant:${tenantId}:location:${locationId}:`;

describe("channels of a staff member", () => {
  it("gives each role only the channels its work needs", () => {
    const channels = (role: keyof typeof STAFF_ROLE_CAPABILITIES) =>
      staffRealtimeChannels({
        capabilities: STAFF_ROLE_CAPABILITIES[role],
        scope
      });
    expect(channels("waiter")).toEqual([`${prefix}salon`]);
    expect(channels("manager")).toEqual([`${prefix}salon`, `${prefix}cash`]);
    expect(channels("kitchen")).toEqual([`${prefix}production-kitchen`]);
    expect(channels("bar")).toEqual([`${prefix}production-bar`]);
  });

  it("gives nothing to someone who can do nothing", () => {
    expect(staffRealtimeChannels({ capabilities: [], scope })).toEqual([]);
  });
});

describe("RealtimeTokenService", () => {
  const now = () => new Date("2026-10-31T12:00:00Z");

  it("signs a short token whose claims are the whole authorization", async () => {
    const service = new RealtimeTokenService(secret, now);
    const grant = await service.issue({
      capabilities: STAFF_ROLE_CAPABILITIES.kitchen,
      scope,
      staffId: "3e000000-0000-4000-8000-0000000000aa"
    });
    const { payload } = await jwtVerify(
      grant.token,
      new TextEncoder().encode(secret),
      { audience: "authenticated", currentDate: now() }
    );
    expect(payload).toMatchObject({
      channels: [`${prefix}production-kitchen`],
      location_id: locationId,
      role: "authenticated",
      sub: "3e000000-0000-4000-8000-0000000000aa",
      tenant_id: tenantId
    });
    expect(payload.exp! - payload.iat!).toBe(REALTIME_TOKEN_SECONDS);
    expect(grant.expiresAt).toBe("2026-10-31T12:10:00.000Z");
    expect(grant.channels).toEqual(payload.channels);
  });

  it("is not accepted by anyone who does not hold the secret, nor after it expires", async () => {
    const grant = await new RealtimeTokenService(secret, now).issue({
      capabilities: STAFF_ROLE_CAPABILITIES.waiter,
      scope,
      staffId: "3e000000-0000-4000-8000-0000000000aa"
    });
    await expect(
      jwtVerify(
        grant.token,
        new TextEncoder().encode("another-secret-with-32-characters!!!"),
        { currentDate: now() }
      )
    ).rejects.toThrow();
    await expect(
      jwtVerify(grant.token, new TextEncoder().encode(secret), {
        currentDate: new Date("2026-10-31T12:11:00Z")
      })
    ).rejects.toThrow();
  });

  it("is off, not broken, without the secret", async () => {
    const service = new RealtimeTokenService(null);
    expect(service.enabled).toBe(false);
    await expect(
      service.issue({
        capabilities: STAFF_ROLE_CAPABILITIES.waiter,
        scope,
        staffId: "x"
      })
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

describe("RealtimeController", () => {
  it("takes everything from the staff session", async () => {
    const controller = new RealtimeController(
      new RealtimeTokenService(secret, () => new Date("2026-10-31T12:00:00Z"))
    );
    const response = await controller.token({
      staffContext: {
        capabilities: STAFF_ROLE_CAPABILITIES.waiter,
        role: "waiter",
        scope,
        staffId: "3e000000-0000-4000-8000-0000000000aa"
      }
    });
    expect(response.data.channels).toEqual([`${prefix}salon`]);
  });
});
