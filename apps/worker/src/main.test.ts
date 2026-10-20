import { describe, expect, it } from "vitest";

import { getWorkerStatus } from "./main.js";

describe("getWorkerStatus", () => {
  it("returns the worker health status", () => {
    expect(getWorkerStatus()).toEqual({
      service: "worker",
      status: "ok"
    });
  });
});
