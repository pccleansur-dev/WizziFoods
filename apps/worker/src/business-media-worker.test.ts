import { describe, expect, it, vi } from "vitest";

import {
  BusinessMediaJobRetryError,
  runBusinessMediaIteration
} from "./business-media-worker.js";

const scope = {
  locationId: "a5000000-0000-4000-8000-000000000005",
  tenantId: "a3000000-0000-4000-8000-000000000003"
};
const envelope = {
  jobId: "a7000000-0000-4000-8000-000000000007",
  kind: "business-media.process",
  payload: { assetId: "a6000000-0000-4000-8000-000000000006" },
  scope
};

function createRepository(
  assetStatus: "failed" | "ready" | "reserved" = "reserved"
) {
  return {
    ackJob: vi.fn().mockResolvedValue(undefined),
    claim: vi.fn().mockResolvedValue({
      contentType: "image/webp" as const,
      kind: "logo" as const,
      objectPath: "canonical.webp"
    }),
    complete: vi.fn().mockResolvedValue({}),
    fail: vi.fn().mockResolvedValue(undefined),
    getStatus: vi.fn(),
    queue: vi.fn(),
    readJob: vi.fn().mockResolvedValue({
      assetStatus,
      envelope,
      expectedScope: scope,
      messageId: "42"
    }),
    reserve: vi.fn()
  };
}

describe("business media worker iteration", () => {
  it("stays idle when the durable queue is empty", async () => {
    const repository = createRepository();
    repository.readJob.mockResolvedValueOnce(null);

    await expect(
      runBusinessMediaIteration({
        repository,
        storage: { download: vi.fn(), replace: vi.fn() },
        visibilityTimeoutSeconds: 120
      })
    ).resolves.toEqual({ status: "idle" });
    expect(repository.readJob).toHaveBeenCalledWith(120);
    expect(repository.ackJob).not.toHaveBeenCalled();
  });

  it("processes and acknowledges a reserved job", async () => {
    const repository = createRepository();
    const processJob = vi.fn().mockResolvedValue("ready");
    const complete = vi.fn();
    const retry = vi.fn();
    const start = vi.fn(() => ({ complete, retry }));

    await expect(
      runBusinessMediaIteration({
        observer: { start },
        processJob,
        repository,
        storage: { download: vi.fn(), replace: vi.fn() },
        visibilityTimeoutSeconds: 120
      })
    ).resolves.toEqual({ messageId: "42", status: "ready" });
    expect(processJob).toHaveBeenCalledWith(
      scope,
      envelope,
      expect.objectContaining({ storage: expect.any(Object) })
    );
    expect(repository.ackJob).toHaveBeenCalledWith("42");
    expect(start).toHaveBeenCalledWith("42");
    expect(complete).toHaveBeenCalledWith("ready");
    expect(retry).not.toHaveBeenCalled();
  });

  it("acknowledges an already terminal job without processing it again", async () => {
    const repository = createRepository("failed");
    const processJob = vi.fn();

    await expect(
      runBusinessMediaIteration({
        processJob,
        repository,
        storage: { download: vi.fn(), replace: vi.fn() },
        visibilityTimeoutSeconds: 120
      })
    ).resolves.toEqual({ messageId: "42", status: "recovered" });
    expect(processJob).not.toHaveBeenCalled();
    expect(repository.ackJob).toHaveBeenCalledWith("42");
  });

  it("keeps a transiently failed job unacknowledged for retry", async () => {
    const repository = createRepository();
    const processJob = vi.fn().mockRejectedValue(new Error("storage offline"));
    const retry = vi.fn();

    const result = runBusinessMediaIteration({
      observer: { start: () => ({ complete: vi.fn(), retry }) },
      processJob,
      repository,
      storage: { download: vi.fn(), replace: vi.fn() },
      visibilityTimeoutSeconds: 120
    });

    await expect(result).rejects.toBeInstanceOf(BusinessMediaJobRetryError);
    await expect(result).rejects.toMatchObject({ messageId: "42" });
    expect(repository.ackJob).not.toHaveBeenCalled();
    expect(retry).toHaveBeenCalledOnce();
  });
});
