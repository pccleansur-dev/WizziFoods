import { randomUUID } from "node:crypto";

import {
  type Attributes,
  type Context,
  SpanStatusCode,
  type Span,
  metrics as metricsApi,
  trace,
  type Tracer
} from "@opentelemetry/api";
import { PrometheusExporter } from "@opentelemetry/exporter-prometheus";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  type ReadableSpan,
  type SpanProcessor
} from "@opentelemetry/sdk-trace";
import pino, { type Logger } from "pino";

const requestIdPattern = /^[A-Za-z0-9._:-]{8,128}$/;
const sensitiveKeyPattern =
  /authorization|cookie|password|passwd|secret|token|api[_-]?key|pin|phone|whatsapp|email|card|cvv|cvc/i;
const safeSpanAttributeKeys = new Set([
  "http.method",
  "http.request.method",
  "http.route",
  "http.status_code",
  "next.route",
  "next.span_category",
  "next.span_name",
  "next.span_type",
  "platform.entry_point",
  "platform.request_id"
]);

type LogFields = Record<string, unknown>;

export type TelemetryOptions = {
  environment: string;
  logLevel: "debug" | "info" | "warn" | "error";
  metricsPort: number;
  serviceName: string;
};

export type HttpMetricInput = {
  durationSeconds: number;
  method: string;
  route: string;
  statusCode: number;
};

export type PlatformLogger = {
  debug: (event: string, fields?: LogFields) => void;
  error: (event: string, fields?: LogFields) => void;
  info: (event: string, fields?: LogFields) => void;
  warn: (event: string, fields?: LogFields) => void;
};

export type PlatformTelemetry = {
  httpMetrics: {
    observe: (input: HttpMetricInput) => void;
  };
  logger: PlatformLogger;
  operationMetrics: {
    observe: (name: string, entryPoint: string) => void;
  };
  sdk: NodeSDK;
  tracer: Tracer;
};

type TelemetryGlobal = typeof globalThis & {
  __platformTelemetryInstances?: Map<string, PlatformTelemetry>;
};

const telemetryGlobal = globalThis as TelemetryGlobal;
const telemetryInstances =
  telemetryGlobal.__platformTelemetryInstances ??
  new Map<string, PlatformTelemetry>();
telemetryGlobal.__platformTelemetryInstances = telemetryInstances;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function redactSensitiveFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveFields(item));
  }

  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [
      key,
      sensitiveKeyPattern.test(key)
        ? "[REDACTED]"
        : redactSensitiveFields(nestedValue)
    ])
  );
}

export function safeSpanAttributes(attributes: Attributes): Attributes {
  return Object.fromEntries(
    Object.entries(attributes).filter(([key]) => safeSpanAttributeKeys.has(key))
  );
}

export function resolveRequestId(
  incoming: string | string[] | undefined,
  generate: () => string = randomUUID
): string {
  const candidate = Array.isArray(incoming) ? incoming[0] : incoming;

  return candidate && requestIdPattern.test(candidate) ? candidate : generate();
}

export function statusClass(statusCode: number): string {
  return `${Math.floor(statusCode / 100)}xx`;
}

export function operationMetricLabels(name: string, entryPoint: string) {
  return {
    entry_point: entryPoint,
    operation: name
  };
}

function createLogger(options: TelemetryOptions): {
  logger: PlatformLogger;
  rawLogger: Logger;
} {
  const rawLogger = pino({
    base: {
      environment: options.environment,
      service: options.serviceName
    },
    level: options.logLevel,
    timestamp: pino.stdTimeFunctions.isoTime
  });

  function write(
    level: "debug" | "info" | "warn" | "error",
    event: string,
    fields: LogFields = {}
  ): void {
    const safeFields = redactSensitiveFields(fields);
    rawLogger[level]({ ...(isRecord(safeFields) ? safeFields : {}), event });
  }

  return {
    logger: {
      debug: (event, fields) => write("debug", event, fields),
      error: (event, fields) => write("error", event, fields),
      info: (event, fields) => write("info", event, fields),
      warn: (event, fields) => write("warn", event, fields)
    },
    rawLogger
  };
}

class StructuredSpanProcessor implements SpanProcessor {
  constructor(private readonly logger: PlatformLogger) {}

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  onEnd(span: ReadableSpan): void {
    const [seconds, nanoseconds] = span.duration;
    const traceId = span.spanContext().traceId;
    this.logger.info("trace_completed", {
      attributes: safeSpanAttributes(span.attributes),
      durationMs: seconds * 1_000 + nanoseconds / 1_000_000,
      entryPoint: span.attributes["platform.entry_point"] ?? "framework",
      name: span.name,
      requestId: span.attributes["platform.request_id"] ?? `trace-${traceId}`,
      spanId: span.spanContext().spanId,
      status: span.status.code,
      traceId
    });
  }

  onStart(span: Span, parentContext: Context): void {
    void span;
    void parentContext;
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

function createHttpMetrics(serviceName: string) {
  const meter = metricsApi.getMeter(serviceName);
  const requests = meter.createCounter("platform.http.server.requests", {
    description: "Total HTTP requests processed"
  });
  const duration = meter.createHistogram("platform.http.server.duration", {
    description: "HTTP request duration in milliseconds",
    unit: "ms"
  });

  return {
    observe(input: HttpMetricInput): void {
      const labels = {
        method: input.method.toUpperCase(),
        route: input.route,
        service: serviceName,
        status_class: statusClass(input.statusCode)
      };
      requests.add(1, labels);
      duration.record(input.durationSeconds * 1_000, labels);
    }
  };
}

function createOperationMetrics(serviceName: string) {
  const meter = metricsApi.getMeter(serviceName);
  const operations = meter.createCounter("platform.operations", {
    description: "Total platform operations started"
  });

  return {
    observe(name: string, entryPoint: string): void {
      operations.add(1, operationMetricLabels(name, entryPoint));
    }
  };
}

export function initializeTelemetry(
  options: TelemetryOptions
): PlatformTelemetry {
  const existing = telemetryInstances.get(options.serviceName);
  if (existing) {
    return existing;
  }

  const { logger } = createLogger(options);
  const prometheus = new PrometheusExporter({
    host: "0.0.0.0",
    port: options.metricsPort
  });
  const sdk = new NodeSDK({
    metricReaders: [prometheus],
    serviceName: options.serviceName,
    spanProcessors: [new StructuredSpanProcessor(logger)]
  });
  sdk.start();

  const telemetry = {
    httpMetrics: createHttpMetrics(options.serviceName),
    logger,
    operationMetrics: createOperationMetrics(options.serviceName),
    sdk,
    tracer: trace.getTracer(options.serviceName)
  };
  telemetryInstances.set(options.serviceName, telemetry);

  return telemetry;
}

export function getTelemetry(
  serviceName: string
): PlatformTelemetry | undefined {
  return telemetryInstances.get(serviceName);
}

export function startOperation(
  telemetry: PlatformTelemetry,
  name: string,
  options: {
    attributes?: Attributes;
    entryPoint: string;
    requestId?: string;
  }
) {
  const requestId = options.requestId ?? randomUUID();
  const span = telemetry.tracer.startSpan(name, {
    attributes: {
      ...options.attributes,
      "platform.entry_point": options.entryPoint,
      "platform.request_id": requestId
    }
  });
  const context = span.spanContext();

  telemetry.operationMetrics.observe(name, options.entryPoint);

  telemetry.logger.info("operation_started", {
    entryPoint: options.entryPoint,
    requestId,
    spanId: context.spanId,
    traceId: context.traceId
  });

  return {
    requestId,
    spanId: context.spanId,
    traceId: context.traceId,
    end(errorCode?: string): void {
      if (errorCode) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: errorCode });
      } else {
        span.setStatus({ code: SpanStatusCode.OK });
      }
      span.end();
    }
  };
}
