import type {
  BusinessMediaRepository,
  QueuedBusinessMediaJob
} from "@platform/database";
import type { TenantScope } from "@platform/contracts";

import {
  processBusinessMediaJob,
  type BusinessMediaJobRepository,
  type BusinessMediaJobStorage
} from "./business-media-job.js";

type BusinessMediaProcessor = (
  expectedScope: TenantScope,
  value: unknown,
  dependencies: {
    repository: BusinessMediaJobRepository;
    storage: BusinessMediaJobStorage;
  }
) => Promise<"failed" | "ready">;

type BusinessMediaIterationInput = {
  processJob?: BusinessMediaProcessor;
  repository: BusinessMediaRepository;
  storage: BusinessMediaJobStorage;
  visibilityTimeoutSeconds: number;
};

export type BusinessMediaIterationResult =
  | { status: "idle" }
  | {
      messageId: string;
      status: "failed" | "ready" | "recovered";
    };

export class BusinessMediaJobRetryError extends Error {
  constructor(
    readonly messageId: string,
    cause: unknown
  ) {
    super("Business media job must be retried", { cause });
    this.name = "BusinessMediaJobRetryError";
  }
}

function createJobRepository(
  repository: BusinessMediaRepository
): BusinessMediaJobRepository {
  return {
    claim: (scope, assetId) => repository.claim({ assetId, scope }),
    complete: async (scope, assetId, metadata) => {
      await repository.complete({ assetId, scope, ...metadata });
    },
    fail: (scope, assetId) => repository.fail({ assetId, scope })
  };
}

function isTerminal(job: QueuedBusinessMediaJob): boolean {
  return job.assetStatus !== "reserved";
}

export async function runBusinessMediaIteration(
  input: BusinessMediaIterationInput
): Promise<BusinessMediaIterationResult> {
  const job = await input.repository.readJob(input.visibilityTimeoutSeconds);
  if (!job) return { status: "idle" };

  try {
    if (isTerminal(job)) {
      await input.repository.ackJob(job.messageId);
      return { messageId: job.messageId, status: "recovered" };
    }

    const status = await (input.processJob ?? processBusinessMediaJob)(
      job.expectedScope,
      job.envelope,
      {
        repository: createJobRepository(input.repository),
        storage: input.storage
      }
    );
    await input.repository.ackJob(job.messageId);
    return { messageId: job.messageId, status };
  } catch (error) {
    throw new BusinessMediaJobRetryError(job.messageId, error);
  }
}
