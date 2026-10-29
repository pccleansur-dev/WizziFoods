import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const styles = readFileSync(
  fileURLToPath(new URL("../styles.css", import.meta.url)),
  "utf8"
);

describe("catalog responsive layout", () => {
  it("keeps the variants editor directly below its product without horizontal overflow", () => {
    expect(styles).toMatch(
      /\.catalog-product\s*>\s*\.catalog-variants\s*\{[^}]*grid-column:\s*1\s*\/\s*-1;[^}]*min-width:\s*0;[^}]*width:\s*100%;/s
    );
    expect(styles).toMatch(
      /\.catalog-variants__head,\s*\.catalog-variants__table\s+\.catalog-variant\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(6\.5rem,\s*8rem\)\s+4\.5rem;/s
    );
  });
});
