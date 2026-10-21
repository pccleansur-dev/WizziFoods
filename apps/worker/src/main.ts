import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

import { readWorkerConfig } from "@platform/config";
import { createServiceStatus, type ServiceStatus } from "@platform/contracts";
import { initializeTelemetry, startOperation } from "@platform/observability";

export function getWorkerStatus(): ServiceStatus {
  return createServiceStatus("worker");
}

function startWorker(): void {
  const config = readWorkerConfig(process.env);
  const telemetry = initializeTelemetry({
    environment: config.environment,
    logLevel: config.logLevel,
    metricsPort: config.metricsPort,
    serviceName: "worker"
  });
  const startup = startOperation(telemetry, "service.start", {
    entryPoint: "process"
  });
  telemetry.logger.info("service_started", {
    entryPoint: "process",
    metricsPort: config.metricsPort,
    requestId: startup.requestId,
    spanId: startup.spanId,
    status: getWorkerStatus().status,
    traceId: startup.traceId
  });
  startup.end();

  setInterval(() => {
    const heartbeat = startOperation(telemetry, "worker.heartbeat", {
      entryPoint: "scheduler"
    });
    telemetry.logger.info("worker_heartbeat", {
      entryPoint: "scheduler",
      requestId: heartbeat.requestId,
      spanId: heartbeat.spanId,
      traceId: heartbeat.traceId
    });
    heartbeat.end();
  }, config.heartbeatMs);
}

const entryPoint = process.argv[1];

if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  try {
    startWorker();
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "service_start_failed",
        message: error instanceof Error ? error.message : "unknown error",
        requestId: randomUUID(),
        service: "worker"
      })
    );
    process.exitCode = 1;
  }
}
