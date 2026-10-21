import { describe, expect, it } from "vitest";

import {
  operationMetricLabels,
  redactSensitiveFields,
  resolveRequestId,
  safeSpanAttributes,
  statusClass
} from "./telemetry.js";

describe("telemetry boundaries", () => {
  it("keeps a safe incoming correlation identifier", () => {
    expect(resolveRequestId("request-1234", () => "generated-id")).toBe(
      "request-1234"
    );
  });

  it("replaces malformed or oversized correlation identifiers", () => {
    expect(resolveRequestId("bad value", () => "generated-id")).toBe(
      "generated-id"
    );
    expect(resolveRequestId("a".repeat(129), () => "generated-id")).toBe(
      "generated-id"
    );
  });

  it("redacts sensitive fields recursively before logging", () => {
    expect(
      redactSensitiveFields({
        authorization: "Bearer secret",
        nested: { pin: "123456", productId: "product-1" },
        requestId: "request-1234"
      })
    ).toEqual({
      authorization: "[REDACTED]",
      nested: { pin: "[REDACTED]", productId: "product-1" },
      requestId: "request-1234"
    });
  });

  it("keeps only approved span attributes", () => {
    expect(
      safeSpanAttributes({
        "http.request.method": "GET",
        "http.status_code": 200,
        "http.target": "/menu?email=private@example.com",
        "next.route": "/menu"
      })
    ).toEqual({
      "http.request.method": "GET",
      "http.status_code": 200,
      "next.route": "/menu"
    });
  });

  it("uses bounded HTTP status classes for metrics", () => {
    expect(statusClass(204)).toBe("2xx");
    expect(statusClass(503)).toBe("5xx");
  });

  it("uses bounded operation labels without correlation identifiers", () => {
    expect(operationMetricLabels("worker.heartbeat", "scheduler")).toEqual({
      entry_point: "scheduler",
      operation: "worker.heartbeat"
    });
  });
});
