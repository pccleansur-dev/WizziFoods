import "reflect-metadata";

import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";

import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication
} from "@nestjs/platform-fastify";
import { readApiConfig } from "@platform/config";
import {
  initializeTelemetry,
  resolveRequestId,
  startOperation
} from "@platform/observability";
import type { FastifyRequest } from "fastify";

import { AppModule } from "./app.module.js";

async function bootstrap(): Promise<void> {
  const config = readApiConfig(process.env);
  const telemetry = initializeTelemetry({
    environment: config.environment,
    logLevel: config.logLevel,
    metricsPort: config.metricsPort,
    serviceName: "api"
  });
  const requestOperations = new WeakMap<
    FastifyRequest,
    {
      operation: ReturnType<typeof startOperation>;
      startedAt: bigint;
    }
  >();
  const adapter = new FastifyAdapter({
    genReqId: (request: IncomingMessage) =>
      resolveRequestId(request.headers["x-request-id"], randomUUID),
    logger: false
  });
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.register(config),
    adapter,
    { logger: false }
  );
  app.enableShutdownHooks();
  const server = adapter.getInstance();

  server.addHook("onRequest", (request, reply, done) => {
    const operation = startOperation(telemetry, "http.request", {
      attributes: { "http.request.method": request.method },
      entryPoint: "http",
      requestId: request.id
    });
    requestOperations.set(request, {
      operation,
      startedAt: process.hrtime.bigint()
    });
    reply.header("x-request-id", operation.requestId);
    reply.header("x-trace-id", operation.traceId);
    done();
  });

  server.addHook("onResponse", (request, reply, done) => {
    const state = requestOperations.get(request);
    if (state) {
      const route = request.routeOptions.url ?? "unmatched";
      const durationSeconds =
        Number(process.hrtime.bigint() - state.startedAt) / 1_000_000_000;
      telemetry.httpMetrics.observe({
        durationSeconds,
        method: request.method,
        route,
        statusCode: reply.statusCode
      });
      telemetry.logger.info("http_request_completed", {
        durationMs: durationSeconds * 1_000,
        entryPoint: "http",
        method: request.method,
        requestId: state.operation.requestId,
        route,
        spanId: state.operation.spanId,
        statusCode: reply.statusCode,
        traceId: state.operation.traceId
      });
      state.operation.end(
        reply.statusCode >= 500 ? "http_server_error" : undefined
      );
      requestOperations.delete(request);
    }
    done();
  });

  await app.listen(config.port, "0.0.0.0");
  const startup = startOperation(telemetry, "service.start", {
    entryPoint: "process"
  });
  telemetry.logger.info("service_started", {
    entryPoint: "process",
    metricsPort: config.metricsPort,
    port: config.port,
    requestId: startup.requestId,
    spanId: startup.spanId,
    traceId: startup.traceId
  });
  startup.end();
}

try {
  await bootstrap();
} catch (error) {
  console.error(
    JSON.stringify({
      event: "service_start_failed",
      message: error instanceof Error ? error.message : "unknown error",
      requestId: randomUUID(),
      service: "api"
    })
  );
  process.exitCode = 1;
}
