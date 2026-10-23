import {
  startOperation,
  type PlatformTelemetry
} from "@platform/observability";

import type { BusinessMediaJobObserver } from "./business-media-worker.js";

const eventForStatus = {
  failed: "business_media_job_rejected",
  ready: "business_media_job_completed",
  recovered: "business_media_job_recovered"
} as const;

export function createBusinessMediaJobObserver(
  telemetry: PlatformTelemetry
): BusinessMediaJobObserver {
  return {
    start(messageId) {
      const operation = startOperation(telemetry, "business-media.process", {
        entryPoint: "queue"
      });
      const fields = {
        entryPoint: "queue",
        messageId,
        requestId: operation.requestId,
        spanId: operation.spanId,
        traceId: operation.traceId
      };

      return {
        complete(status) {
          telemetry.logger.info(eventForStatus[status], { ...fields, status });
          operation.end();
        },
        retry() {
          telemetry.logger.warn("business_media_job_retry", {
            ...fields,
            reason: "transient_failure"
          });
          operation.end("transient_failure");
        }
      };
    }
  };
}
