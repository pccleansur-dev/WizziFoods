import { describe, expect, it } from "vitest";

import { createServiceStatus } from "./service-status.js";

describe("createServiceStatus", () => {
  it("reports the named service as ready", () => {
    expect(createServiceStatus("api")).toEqual({
      service: "api",
      status: "ok"
    });
  });
});
