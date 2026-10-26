import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

import { readWorkerConfig } from "@platform/config";
import { createServiceStatus, type ServiceStatus } from "@platform/contracts";
import { createTenantDatabase } from "@platform/database";
import {
  MetaWhatsappProvider,
  PaymentSecretSealer,
  SimulatedWhatsappProvider,
  type WhatsappProvider
} from "@platform/integrations";
import { initializeTelemetry, startOperation } from "@platform/observability";

import { createBusinessMediaJobObserver } from "./business-media-observer.js";
import { createSupabaseBusinessMediaStorage } from "./business-media-storage.js";
import {
  BusinessMediaJobRetryError,
  runBusinessMediaIteration
} from "./business-media-worker.js";
import {
  CatalogImportJobRetryError,
  runCatalogImportIteration
} from "./catalog-import-worker.js";
import {
  runAutomationsIteration,
  runMessagingIteration
} from "./messaging-worker.js";
import { startPollingLoop } from "./polling-loop.js";

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
  const database = createTenantDatabase(config.databaseUrl);
  const storage = createSupabaseBusinessMediaStorage(
    config.supabaseUrl,
    config.supabaseSecretKey
  );
  const observer = createBusinessMediaJobObserver(telemetry);
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

  const heartbeatTimer = setInterval(() => {
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

  const mediaPolling = startPollingLoop({
    iteration: async () => {
      await runBusinessMediaIteration({
        observer,
        repository: database.businessMediaRepository,
        storage,
        visibilityTimeoutSeconds: config.visibilityTimeoutSeconds
      });
    },
    onError: (error) => {
      if (error instanceof BusinessMediaJobRetryError) return;
      telemetry.logger.warn("business_media_queue_retry", {
        entryPoint: "queue",
        reason: "queue_unavailable",
        requestId: randomUUID()
      });
    },
    pollMs: config.pollMs
  });
  const importPolling = startPollingLoop({
    iteration: async () => {
      await runCatalogImportIteration({
        repository: database.catalogImportRepository,
        visibilityTimeoutSeconds: config.visibilityTimeoutSeconds
      });
    },
    onError: (error) => {
      if (error instanceof CatalogImportJobRetryError) return;
      telemetry.logger.warn("catalog_import_queue_retry", {
        entryPoint: "queue",
        reason: "queue_unavailable",
        requestId: randomUUID()
      });
    },
    pollMs: config.pollMs
  });

  // Messaging is optional: with WHATSAPP_MODE=off (the default) nothing is polled.
  const loops = [mediaPolling, importPolling];
  if (config.whatsapp.mode !== "off" && config.paymentSecretKey) {
    const sealer = new PaymentSecretSealer(config.paymentSecretKey);
    const provider: WhatsappProvider =
      config.whatsapp.mode === "simulated"
        ? new SimulatedWhatsappProvider(config.environment)
        : new MetaWhatsappProvider({
            graphVersion: config.whatsapp.graphVersion
          });
    loops.push(
      startPollingLoop({
        iteration: async () => {
          const summary = await runMessagingIteration({
            leaseSeconds: config.visibilityTimeoutSeconds,
            limit: 20,
            provider,
            repository: database.messagingRepository,
            sealer
          });
          if (
            summary.sent + summary.blocked + summary.failed + summary.retried >
            0
          ) {
            telemetry.logger.info("messaging_iteration", {
              entryPoint: "queue",
              requestId: randomUUID(),
              ...summary
            });
          }
        },
        onError: () => {
          telemetry.logger.warn("messaging_queue_retry", {
            entryPoint: "queue",
            reason: "queue_unavailable",
            requestId: randomUUID()
          });
        },
        pollMs: config.pollMs
      }),
      startPollingLoop({
        iteration: async () => {
          await runAutomationsIteration({
            repository: database.messagingRepository
          });
        },
        onError: () => {
          telemetry.logger.warn("messaging_automations_retry", {
            entryPoint: "scheduler",
            reason: "queue_unavailable",
            requestId: randomUUID()
          });
        },
        pollMs: 60_000
      })
    );
  }

  let shutdownPromise: Promise<void> | undefined;
  const shutdown = (signal: "SIGINT" | "SIGTERM") => {
    shutdownPromise ??= (async () => {
      telemetry.logger.info("service_stopping", {
        entryPoint: "process",
        requestId: randomUUID(),
        signal
      });
      clearInterval(heartbeatTimer);
      await Promise.all(loops.map((loop) => loop.stop()));
      await database.close();
      await telemetry.sdk.shutdown();
    })();
    return shutdownPromise;
  };

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void shutdown(signal).catch(() => {
        process.exitCode = 1;
      });
    });
  }
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
