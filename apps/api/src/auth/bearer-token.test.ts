import { UnauthorizedException } from "@nestjs/common";
import { describe, expect, it } from "vitest";

import { extractBearerToken } from "./bearer-token.js";

describe("extractBearerToken", () => {
  it("extracts one bearer token", () => {
    expect(extractBearerToken("Bearer signed.jwt.value")).toBe(
      "signed.jwt.value"
    );
  });

  it.each([undefined, "", "Basic abc", "Bearer", "Bearer one two"])(
    "rejects a missing or malformed authorization header: %s",
    (authorization) => {
      expect(() => extractBearerToken(authorization)).toThrow(
        UnauthorizedException
      );
    }
  );
});
