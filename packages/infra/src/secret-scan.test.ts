import { describe, expect, it } from "vitest";

import { findPotentialSecrets } from "./secret-scan.js";

describe("findPotentialSecrets", () => {
  it("detects provider keys without exposing their value", () => {
    const findings = findPotentialSecrets(
      "config.ts",
      `const key = "${"AI" + "za12345678901234567890123456789012345"}";\n`
    );

    expect(findings).toEqual([
      {
        file: "config.ts",
        line: 1,
        rule: "google-api-key"
      }
    ]);
    expect(JSON.stringify(findings)).not.toContain("AIza");
  });

  it("detects private key material", () => {
    const findings = findPotentialSecrets(
      "private.pem",
      `${"-----BEGIN " + "PRIVATE KEY-----"}\n`
    );

    expect(findings[0]?.rule).toBe("private-key");
  });

  it("allows documented placeholders and explicit safe lines", () => {
    const content = [
      "API_KEY=replace-with-a-real-key",
      "TOKEN=development-placeholder",
      "POSTGRES_PASSWORD=your-super-secret-and-long-postgres-password",
      'test_password="smoke-test-password-123456"',
      "# password=d0notUseThisCommentedExample123",
      "local apikey = extract_query_apikey(path)",
      'const fixture = "ghp_123456789012345678901234567890123456"; // secret-scan: allow'
    ].join("\n");

    expect(findPotentialSecrets(".env.example", content)).toEqual([]);
  });
});
