import type {
  BusinessMediaRepository,
  GetBusinessMediaStatusInput,
  QueueBusinessMediaInput
} from "@platform/database";
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
  it("reads status using only the authenticated tenant scope", async () => {
    const received: unknown[] = [];
    const repository = {
      getStatus: async (input: GetBusinessMediaStatusInput) => {
        received.push(input);
        return {
          id: "e6000000-0000-4000-8000-000000000006",
          kind: "logo" as const,
          status: "ready" as const
        };
      }
    } as unknown as BusinessMediaRepository;
    const service = new BusinessMediaService(repository, {} as never);

    await expect(
      service.getStatus(context, "e6000000-0000-4000-8000-000000000006")
    ).resolves.toEqual({
      assetId: "e6000000-0000-4000-8000-000000000006",
      kind: "logo",
      status: "ready"
    });
    expect(received).toEqual([
      {
        assetId: "e6000000-0000-4000-8000-000000000006",
        requesterId: context.identity.userId,
        scope: context.scope
      }
    ]);
  });

  it("presents a reserved asset as processing", async () => {
    const repository = {
      getStatus: async () => ({
        id: "e6000000-0000-4000-8000-000000000006",
        kind: "cover" as const,
        status: "reserved" as const
      })
    } as unknown as BusinessMediaRepository;
    const service = new BusinessMediaService(repository, {} as never);

    await expect(
      service.getStatus(context, "e6000000-0000-4000-8000-000000000006")
    ).resolves.toMatchObject({ status: "processing" });
  });

  it("queues an uploaded asset using only the authenticated tenant scope", async () => {
    const received: unknown[] = [];
    const repository = {
      queue: async (input: QueueBusinessMediaInput) => {
        received.push(input);
        return {
          id: "e6000000-0000-4000-8000-000000000006",
          processingMessageId: 42,
          status: "reserved" as const
        };
      }
    } as unknown as BusinessMediaRepository;
    const service = new BusinessMediaService(repository, {} as never);

    await expect(
      service.queue(context, "e6000000-0000-4000-8000-000000000006")
    ).resolves.toEqual({
      assetId: "e6000000-0000-4000-8000-000000000006",
      status: "processing"
    });
    expect(received).toEqual([
      {
        assetId: "e6000000-0000-4000-8000-000000000006",
        requesterId: context.identity.userId,
        scope: context.scope
      }
    ]);
  });

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
