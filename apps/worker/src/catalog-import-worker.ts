import type {
  CatalogImportRepository,
  QueuedCatalogImportJob
} from "@platform/database";
import type { TenantScope } from "@platform/contracts";

import { processCatalogImportJob } from "./catalog-import-job.js";

type Processor = (
  expectedScope: TenantScope,
  envelope: unknown,
  dependencies: { repository: CatalogImportRepository }
) => Promise<void>;

export class CatalogImportJobRetryError extends Error {
  constructor(
    readonly messageId: string,
    cause: unknown
  ) {
    super("Catalog import job must be retried", { cause });
    this.name = "CatalogImportJobRetryError";
  }
}

function terminal(job: QueuedCatalogImportJob): boolean {
  return ["approved", "discarded", "failed", "review"].includes(
    job.importStatus
  );
}

function importIdFrom(job: QueuedCatalogImportJob): string {
  const payload =
    typeof job.envelope === "object" &&
    job.envelope !== null &&
    "payload" in job.envelope
      ? job.envelope.payload
      : null;
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("importId" in payload) ||
    typeof payload.importId !== "string"
  ) {
    throw new Error("catalog import message has no import identifier");
  }
  return payload.importId;
}

export async function runCatalogImportIteration(input: {
  processJob?: Processor;
  repository: CatalogImportRepository;
  visibilityTimeoutSeconds: number;
}): Promise<
  | { status: "idle" }
  | { messageId: string; status: "failed" | "recovered" | "review" }
> {
  const job = await input.repository.readJob(input.visibilityTimeoutSeconds);
  if (!job) return { status: "idle" };
  if (terminal(job)) {
    await input.repository.ackJob(job.messageId);
    return { messageId: job.messageId, status: "recovered" };
  }
  try {
    await (input.processJob ?? processCatalogImportJob)(
      job.expectedScope,
      job.envelope,
      { repository: input.repository }
    );
    await input.repository.ackJob(job.messageId);
    return { messageId: job.messageId, status: "review" };
  } catch (error) {
    if (job.readCount < 3) {
      throw new CatalogImportJobRetryError(job.messageId, error);
    }
    await input.repository.fail({
      importId: importIdFrom(job),
      scope: job.expectedScope
    });
    await input.repository.ackJob(job.messageId);
    return { messageId: job.messageId, status: "failed" };
  }
}
