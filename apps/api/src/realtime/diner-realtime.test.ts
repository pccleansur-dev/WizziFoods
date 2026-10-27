import { ServiceUnavailableException } from "@nestjs/common";
import { jwtVerify } from "jose";
import { describe, expect, it } from "vitest";

import { DinerRealtimeController } from "./diner-realtime.controller.js";
import { RealtimeTokenService } from "./realtime-token.service.js";

const tenantId = "3e200000-0000-4000-8000-000000000001";
const locationId = "3e200000-0000-4000-8000-000000000002";
const tableId = "3e600000-0000-4000-8000-000000000001";
const secret = "a-jwt-secret-with-at-least-32-characters!";
const now = () => new Date("2026-10-31T12:00:00Z");
const token = "a".repeat(64);
const request = {
  tenantHostContext: {
    location: { id: locationId },
    tenant: { id: tenantId }
  }
} as never;

function controller(tables: Record<string, string | null> = {}) {
  const asked: string[] = [];
  const instance = new DinerRealtimeController(
    new RealtimeTokenService(secret, now),
    {
      async resolveQr(_scope: unknown, qr: string) {
        asked.push(qr);
        const id = tables[qr];
        return id
          ? { group: null, label: "1", sectorName: "Salón", tableId: id }
          : null;
      }
    }
  );
  return { asked, instance };
}

async function verify(jwt: string) {
  const { payload } = await jwtVerify(jwt, new TextEncoder().encode(secret), {
    audience: "authenticated",
    currentDate: now()
  });
  return payload;
}

describe("a diner's token", () => {
  it("opens exactly the channel of the table the QR stands for", async () => {
    const { instance } = controller({ [token]: tableId });
    const response = await instance.token(request, { token });
    const channel = `tenant:${tenantId}:location:${locationId}:table-${tableId}`;
    expect(response.data.channels).toEqual([channel]);
    const payload = await verify(response.data.token);
    expect(payload.channels).toEqual([channel]);
    expect(payload).toMatchObject({ role: "authenticated" });
    // Nobody is identified: each phone gets its own anonymous subject.
    const again = await verify(
      (await instance.token(request, { token })).data.token
    );
    expect(again.sub).not.toBe(payload.sub);
  });

  it("gives nothing for a QR that does not exist, nor for a malformed request", async () => {
    const { asked, instance } = controller({});
    await expect(instance.token(request, { token })).rejects.toMatchObject({
      status: 404
    });
    await expect(instance.token(request, { token: "x" })).rejects.toMatchObject(
      { status: 400 }
    );
    await expect(
      instance.token(request, { extra: 1, token })
    ).rejects.toMatchObject({ status: 400 });
    await expect(instance.token(request, null)).rejects.toMatchObject({
      status: 400
    });
    expect(asked).toEqual([token]);
  });

  it("is off, not broken, without the secret", async () => {
    const instance = new DinerRealtimeController(
      new RealtimeTokenService(null),
      {
        async resolveQr() {
          return { group: null, label: "1", sectorName: "Salón", tableId };
        }
      }
    );
    await expect(instance.token(request, { token })).rejects.toBeInstanceOf(
      ServiceUnavailableException
    );
  });
});
