import { describe, expect, it } from "vitest";
import { parseGoogleReviewUrl } from "./business-profile.js";

describe("Google review links", () => {
  it("accepts links from Google Business Profile and direct place links", () => {
    for (const link of [
      "https://g.page/r/abc/review",
      "https://search.google.com/local/writereview?placeid=abc",
      "https://maps.app.goo.gl/abc"
    ]) {
      expect(parseGoogleReviewUrl(link)).toBe(link);
    }
  });
  it("rejects external hosts, insecure URLs and other Google endpoints", () => {
    for (const link of [
      "https://g.page.example.org/r/abc/review",
      "http://g.page/r/abc/review",
      "https://www.google.com/url?q=https://example.org",
      "https://g.page@other.example/r/abc/review"
    ]) {
      expect(parseGoogleReviewUrl(link)).toBeNull();
    }
  });
});
