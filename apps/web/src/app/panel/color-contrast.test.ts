import { describe, expect, it } from "vitest";

import { contrastRatio, readableTextColor } from "./color-contrast";

describe("profile color contrast", () => {
  it("calculates WCAG contrast for canonical colors", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBe(21);
    expect(contrastRatio("#777777", "#FFFFFF")).toBeLessThan(4.5);
  });

  it("selects the safer text color for an accent", () => {
    expect(readableTextColor("#D97706")).toBe("#111111");
    expect(readableTextColor("#1F2937")).toBe("#FFFFFF");
  });
});
