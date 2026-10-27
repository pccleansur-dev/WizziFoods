import { ServiceUnavailableException } from "@nestjs/common";
import { describe, expect, it } from "vitest";

import { ReadinessController } from "./readiness.controller.js";

describe("ReadinessController", () => {
  it("is ready when the database answers", async () => {
    const controller = new ReadinessController({ ping: async () => undefined });
    await expect(controller.getReady()).resolves.toEqual({
      checks: { database: "ok" },
      service: "api",
      status: "ready"
    });
  });

  it("is not ready, and says only that, when the database does not answer", async () => {
    const controller = new ReadinessController({
      ping: async () => {
        throw new Error("connect ECONNREFUSED 10.0.0.5:5432 password=secret");
      }
    });
    const failure = await controller.getReady().catch((error) => error);
    expect(failure).toBeInstanceOf(ServiceUnavailableException);
    expect(failure.getResponse()).toEqual({
      checks: { database: "unavailable" },
      service: "api",
      status: "not_ready"
    });
    expect(JSON.stringify(failure.getResponse())).not.toContain("secret");
  });

  it("does not wait forever for a database that hangs", async () => {
    const controller = new ReadinessController({
      ping: () => new Promise(() => undefined)
    });
    controller.timeoutMs = 50;
    await expect(controller.getReady()).rejects.toBeInstanceOf(
      ServiceUnavailableException
    );
  });
});
