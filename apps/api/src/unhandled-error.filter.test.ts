import { type ArgumentsHost, BadRequestException } from "@nestjs/common";
import { BaseExceptionFilter } from "@nestjs/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UnhandledErrorFilter } from "./unhandled-error.filter.js";

const host = {
  switchToHttp: () => ({
    getRequest: () => ({
      id: "req-1",
      method: "GET",
      routeOptions: { url: "/v1/platform/operations" }
    })
  })
} as unknown as ArgumentsHost;

describe("UnhandledErrorFilter", () => {
  afterEach(() => vi.restoreAllMocks());

  it("logs an unexpected error with its request and still delegates the answer", () => {
    const delegate = vi
      .spyOn(BaseExceptionFilter.prototype, "catch")
      .mockImplementation(() => undefined);
    const logger = {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn()
    };
    const filter = new UnhandledErrorFilter(logger, {} as never);

    const error = new TypeError(
      "row.occurred_at.toISOString is not a function"
    );
    filter.catch(error, host);

    expect(logger.error).toHaveBeenCalledWith(
      "unhandled_request_error",
      expect.objectContaining({
        errorName: "TypeError",
        message: error.message,
        requestId: "req-1",
        route: "/v1/platform/operations"
      })
    );
    expect(delegate).toHaveBeenCalledWith(error, host);
  });

  it("does not log errors that are already a deliberate HTTP answer", () => {
    vi.spyOn(BaseExceptionFilter.prototype, "catch").mockImplementation(
      () => undefined
    );
    const logger = {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn()
    };
    const filter = new UnhandledErrorFilter(logger, {} as never);

    filter.catch(new BadRequestException("nope"), host);

    expect(logger.error).not.toHaveBeenCalled();
  });
});
