import type { CatalogImportRepository } from "@platform/database";
import { describe, expect, it, vi } from "vitest";

import {
  CatalogImportJobRetryError,
  runCatalogImportIteration
} from "./catalog-import-worker.js";

const scope = {
  locationId: "d5322dbe-1883-4a09-a29a-5f108ba4999b",
  tenantId: "6b9532a7-fcda-4e0d-8df7-55298f711902"
};
const importId = "63a64f34-4df0-4c2f-82ea-5ea308fe2cab";

function repository(readCount: number): CatalogImportRepository {
  return {
    ackJob: vi.fn(),
    claim: vi.fn(),
    complete: vi.fn(),
    discard: vi.fn(),
    enqueue: vi.fn(),
    fail: vi.fn(),
    get: vi.fn(),
    list: vi.fn(),
    markApproved: vi.fn(),
    readJob: vi.fn().mockResolvedValue({
      envelope: {
        jobId: "6cf6b56b-bb6e-4f89-8ca7-cbe499d33d8b",
        kind: "catalog-import.process",
        payload: { importId },
        scope
      },
      expectedScope: scope,
      importStatus: "queued",
      messageId: "41",
      readCount
    })
  };
}

describe("catalog import worker", () => {
  it("leaves transient failures for retry before the delivery limit", async () => {
    const imports = repository(1);
    await expect(
      runCatalogImportIteration({
        processJob: vi.fn().mockRejectedValue(new Error("temporary")),
        repository: imports,
        visibilityTimeoutSeconds: 30
      })
    ).rejects.toBeInstanceOf(CatalogImportJobRetryError);
    expect(imports.fail).not.toHaveBeenCalled();
    expect(imports.ackJob).not.toHaveBeenCalled();
  });

  it("fails and acknowledges poison jobs after three deliveries", async () => {
    const imports = repository(3);
    await expect(
      runCatalogImportIteration({
        processJob: vi.fn().mockRejectedValue(new Error("permanent")),
        repository: imports,
        visibilityTimeoutSeconds: 30
      })
    ).resolves.toEqual({ messageId: "41", status: "failed" });
    expect(imports.fail).toHaveBeenCalledWith({ importId, scope });
    expect(imports.ackJob).toHaveBeenCalledWith("41");
  });

  it("acknowledges a terminal import without processing it twice", async () => {
    const imports = repository(2);
    vi.mocked(imports.readJob).mockResolvedValueOnce({
      envelope: {},
      expectedScope: scope,
      importStatus: "review",
      messageId: "41",
      readCount: 2
    });
    const processJob = vi.fn();

    await expect(
      runCatalogImportIteration({
        processJob,
        repository: imports,
        visibilityTimeoutSeconds: 30
      })
    ).resolves.toEqual({ messageId: "41", status: "recovered" });
    expect(processJob).not.toHaveBeenCalled();
  });
});
