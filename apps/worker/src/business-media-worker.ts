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
  observer?: BusinessMediaJobObserver;
  processJob?: BusinessMediaProcessor;
  repository: BusinessMediaRepository;
  storage: BusinessMediaJobStorage;
  visibilityTimeoutSeconds: number;
};

export type BusinessMediaJobObserver = {
  start(messageId: string): {
    complete(status: "failed" | "ready" | "recovered"): void;
    retry(): void;
  };
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
  let observation: ReturnType<BusinessMediaJobObserver["start"]> | undefined;
  try {
    observation = input.observer?.start(job.messageId);
  } catch {
    // Telemetry must never change durable job processing semantics.
  }

  try {
    if (isTerminal(job)) {
      await input.repository.ackJob(job.messageId);
      try {
        observation?.complete("recovered");
      } catch {
        // Telemetry must never change durable job processing semantics.
      }
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
    try {
      observation?.complete(status);
    } catch {
      // Telemetry must never change durable job processing semantics.
    }
    return { messageId: job.messageId, status };
  } catch (error) {
    try {
      observation?.retry();
    } catch {
      // Telemetry must never change durable job processing semantics.
    }
    throw new BusinessMediaJobRetryError(job.messageId, error);
  }
}
