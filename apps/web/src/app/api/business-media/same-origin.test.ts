import { describe, expect, it } from "vitest";

import { isSameOrigin } from "./same-origin";

describe("business media same-origin boundary", () => {
  it("accepts only the exact browser origin", () => {
    expect(
      isSameOrigin(
        new Request("http://local.test/api/business-media", {
          headers: { host: "local.test", origin: "http://local.test" }
        })
      )
    ).toBe(true);
    expect(
      isSameOrigin(
        new Request("http://local.test/api/business-media", {
          headers: {
            host: "local.test",
            origin: "https://attacker.local.test"
          }
        })
      )
    ).toBe(false);
  });

  it("rejects missing or malformed origin metadata", () => {
    expect(
      isSameOrigin(
        new Request("http://local.test/api/business-media", {
          headers: { host: "local.test" }
        })
      )
    ).toBe(false);
    expect(
      isSameOrigin(
        new Request("http://local.test/api/business-media", {
          headers: { host: "local.test", origin: "not-a-url" }
        })
      )
    ).toBe(false);
  });
});
