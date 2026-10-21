import { readWebConfig } from "@platform/config";
import { initializeTelemetry, startOperation } from "@platform/observability";

const config = readWebConfig(process.env);
const telemetry = initializeTelemetry({
  environment: config.environment,
  logLevel: config.logLevel,
  metricsPort: config.metricsPort,
  serviceName: "web"
});
const startup = startOperation(telemetry, "service.start", {
  entryPoint: "process"
});

telemetry.logger.info("service_started", {
  entryPoint: "process",
  metricsPort: config.metricsPort,
  requestId: startup.requestId,
  spanId: startup.spanId,
  traceId: startup.traceId
});
startup.end();
