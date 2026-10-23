import type { BusinessMediaRepository } from "@platform/database";
import { describe, expect, it } from "vitest";

import type { TenantAdminRequestContext } from "../tenants/tenant-admin-scope.service.js";
import type { BusinessMediaStorageGateway } from "./business-media-storage.gateway.js";
import { BusinessMediaService } from "./business-media.service.js";

const context = {
  identity: { userId: "e1000000-0000-4000-8000-000000000001" },
  scope: {
    locationId: "e5000000-0000-4000-8000-000000000005",
    tenantId: "e3000000-0000-4000-8000-000000000003"
  }
} as TenantAdminRequestContext;

describe("BusinessMediaService", () => {
  it("reserves a scoped path before signing its upload URL", async () => {
    const received: unknown[] = [];
    const repository = {
      reserve: async (input) => {
        received.push(["reserve", input]);
        return {
          contentType: "image/jpeg",
          expiresAt: "2026-10-23T00:30:00.000Z",
          id: "e6000000-0000-4000-8000-000000000006",
          kind: "logo",
          objectPath: "tenants/scoped/logo.jpg",
          sourceSizeBytes: 2048,
          status: "reserved"
        };
      }
    } as BusinessMediaRepository;
    const storage = {
      createUploadUrl: async (path) => {
        received.push(["sign", path]);
        return "https://storage.test/upload";
      }
    } as BusinessMediaStorageGateway;
    const service = new BusinessMediaService(repository, storage);

    await expect(
      service.reserve(context, {
        byteLength: 2048,
        contentType: "image/jpeg",
        kind: "logo"
      })
    ).resolves.toMatchObject({ uploadUrl: "https://storage.test/upload" });
    expect(received).toEqual([
      [
        "reserve",
        {
          byteLength: 2048,
          contentType: "image/jpeg",
          kind: "logo",
          requesterId: context.identity.userId,
          scope: context.scope
        }
      ],
      ["sign", "tenants/scoped/logo.jpg"]
    ]);
  });
});
