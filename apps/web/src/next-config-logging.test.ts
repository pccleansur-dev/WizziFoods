import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("next.config", () => {
  it("keeps Server Function arguments out of server logs", () => {
    // Server Actions receive PINs and provider credentials as arguments.
    const source = readFileSync(
      resolve(import.meta.dirname, "../next.config.ts"),
      "utf8"
    );
    expect(source).toMatch(/serverFunctions:\s*false/u);
  });
});
