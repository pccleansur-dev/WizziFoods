import type { PlatformTelemetry } from "@platform/observability";
import { describe, expect, it, vi } from "vitest";

import { createBusinessMediaJobObserver } from "./business-media-observer.js";

function createTelemetry() {
  const logger = {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn()
  };
  const span = {
    end: vi.fn(),
    setStatus: vi.fn(),
    spanContext: () => ({ spanId: "span-id", traceId: "trace-id" })
  };
  const telemetry = {
    logger,
    operationMetrics: { observe: vi.fn() },
    tracer: { startSpan: vi.fn(() => span) }
  } as unknown as PlatformTelemetry;
  return { logger, span, telemetry };
}

describe("business media job observer", () => {
  it("records a completed queue job with bounded operation labels", () => {
    const { logger, span, telemetry } = createTelemetry();
    const run = createBusinessMediaJobObserver(telemetry).start("42");

    run.complete("ready");

    expect(telemetry.operationMetrics.observe).toHaveBeenCalledWith(
      "business-media.process",
      "queue"
    );
    expect(logger.info).toHaveBeenCalledWith(
      "business_media_job_completed",
      expect.objectContaining({
        entryPoint: "queue",
        messageId: "42",
        requestId: expect.any(String),
        spanId: "span-id",
        status: "ready",
        traceId: "trace-id"
      })
    );
    expect(span.end).toHaveBeenCalledOnce();
  });

  it("records retry intent without logging provider errors", () => {
    const { logger, span, telemetry } = createTelemetry();
    const run = createBusinessMediaJobObserver(telemetry).start("42");

    run.retry();

    expect(logger.warn).toHaveBeenCalledWith(
      "business_media_job_retry",
      expect.objectContaining({
        entryPoint: "queue",
        messageId: "42",
        reason: "transient_failure"
      })
    );
    expect(span.setStatus).toHaveBeenCalledWith(
      expect.objectContaining({ message: "transient_failure" })
    );
    expect(span.end).toHaveBeenCalledOnce();
  });
});
