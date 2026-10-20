import { describe, expect, it } from "vitest";

import { AppController } from "./app.controller.js";

describe("AppController", () => {
  it("returns the API health status", () => {
    expect(new AppController().getHealth()).toEqual({
      service: "api",
      status: "ok"
    });
  });
});
