import { describe, expect, it } from "vitest";

import { formatBusinessDateTime } from "./business-time";

describe("formatBusinessDateTime", () => {
  it("shows Buenos Aires time even when the server runs in UTC", () => {
    // 02:35 UTC del 30/10 son las 23:35 del 29/10 en Buenos Aires (UTC-3).
    const text = formatBusinessDateTime("2026-10-30T02:35:00.000Z");

    expect(text).toContain("29/10/26");
    expect(text).toMatch(/11:35/u);
    expect(text).not.toContain("30/10");
  });

  it("does not drift across a day boundary the other way", () => {
    expect(formatBusinessDateTime("2026-10-29T15:05:00.000Z")).toMatch(
      /29\/10\/26.*12:05/u
    );
  });
});
