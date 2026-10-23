import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  processBusinessMediaJob,
  type BusinessMediaJobRepository,
  type BusinessMediaJobStorage
} from "./business-media-job.js";

const scope = {
  locationId: "e5000000-0000-4000-8000-000000000005",
  tenantId: "e3000000-0000-4000-8000-000000000003"
};
const assetId = "e6000000-0000-4000-8000-000000000006";
const objectPath = `tenants/${scope.tenantId}/locations/${scope.locationId}/business-profile/logo/${assetId}.png`;
const envelope = {
  jobId: "e7000000-0000-4000-8000-000000000007",
  kind: "business-media.process",
  payload: { assetId },
  scope
};

describe("business media job", () => {
  it("processes trusted metadata and completes the same scoped asset", async () => {
    const events: unknown[] = [];
    const source = await sharp({
      create: {
        background: "#a63d2f",
        channels: 3,
        height: 80,
        width: 120
      }
    })
      .png()
      .toBuffer();
    const repository = {
      claim: async (receivedScope, receivedAssetId) => {
        events.push(["claim", receivedScope, receivedAssetId]);
        return { contentType: "image/png", kind: "logo", objectPath };
      },
      complete: async (receivedScope, receivedAssetId, metadata) => {
        events.push(["complete", receivedScope, receivedAssetId, metadata]);
      },
      fail: async () => undefined
    } satisfies BusinessMediaJobRepository;
    const storage = {
      download: async (path) => {
        events.push(["download", path]);
        return source;
      },
      replace: async (path, bytes, contentType) => {
        events.push(["replace", path, bytes.byteLength, contentType]);
      }
    } satisfies BusinessMediaJobStorage;

    await expect(
      processBusinessMediaJob(scope, envelope, { repository, storage })
    ).resolves.toBe("ready");
    expect(events.map((event) => (event as unknown[])[0])).toEqual([
      "claim",
      "download",
      "replace",
      "complete"
    ]);
    expect(events.at(-1)).toEqual([
      "complete",
      scope,
      assetId,
      expect.objectContaining({ height: 80, width: 120 })
    ]);
  });

  it("marks a deterministic invalid image as failed without replacing it", async () => {
    const events: string[] = [];
    const repository = {
      claim: async () => ({
        contentType: "image/png" as const,
        kind: "logo" as const,
        objectPath
      }),
      complete: async () => undefined,
      fail: async () => {
        events.push("fail");
      }
    } satisfies BusinessMediaJobRepository;
    const storage = {
      download: async () => Buffer.from("invalid"),
      replace: async () => {
        events.push("replace");
      }
    } satisfies BusinessMediaJobStorage;

    await expect(
      processBusinessMediaJob(scope, envelope, { repository, storage })
    ).resolves.toBe("failed");
    expect(events).toEqual(["fail"]);
  });

  it("rejects cross-tenant, malformed and non-canonical jobs before download", async () => {
    const unreachable = (() => {
      throw new Error("dependencies must not be called");
    }) as never;
    const dependencies = {
      repository: {
        claim: unreachable,
        complete: unreachable,
        fail: unreachable
      } as BusinessMediaJobRepository,
      storage: {} as BusinessMediaJobStorage
    };

    await expect(
      processBusinessMediaJob(
        scope,
        {
          ...envelope,
          scope: { ...scope, tenantId: "e9000000-0000-4000-8000-000000000009" }
        },
        dependencies
      )
    ).rejects.toThrow("tenant scope mismatch");
    await expect(
      processBusinessMediaJob(
        scope,
        { ...envelope, payload: { assetId, objectPath } },
        dependencies
      )
    ).rejects.toThrow("invalid business media job payload");
  });

  it("rejects a path that does not match trusted tenant metadata", async () => {
    const repository = {
      claim: async () => ({
        contentType: "image/png" as const,
        kind: "logo" as const,
        objectPath: "tenants/another/location/profile.png"
      }),
      complete: async () => undefined,
      fail: async () => undefined
    } satisfies BusinessMediaJobRepository;

    await expect(
      processBusinessMediaJob(scope, envelope, {
        repository,
        storage: {} as BusinessMediaJobStorage
      })
    ).rejects.toThrow("claimed business media path is not canonical");
  });
});
