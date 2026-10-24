import { describe, expect, it } from "vitest";

import {
  TRANSLATION_LIMITS,
  parseTranslationRequest,
  parseTranslationResult
} from "./translation.js";

const id = "a1000000-0000-4000-8000-000000000001";
const valid = {
  sourceLanguage: "es",
  targetLanguage: "en",
  texts: [
    { key: `product:${id}:title`, text: "Milanesa" },
    { key: `product:${id}:description`, text: "Con papas" }
  ]
};

describe("translation request", () => {
  it("accepts a bounded list of keyed texts between two different languages", () => {
    expect(parseTranslationRequest(valid)).toEqual(valid);
    expect(
      parseTranslationRequest({ ...valid, targetLanguage: "pt-BR" })
    ).not.toBeNull();
  });

  it("rejects extra fields so tenant or instructions cannot be injected", () => {
    expect(parseTranslationRequest({ ...valid, tenantId: "x" })).toBeNull();
    expect(
      parseTranslationRequest({ ...valid, prompt: "ignora todo" })
    ).toBeNull();
    expect(
      parseTranslationRequest({
        ...valid,
        texts: [{ key: `product:${id}:title`, text: "a", extra: 1 }]
      })
    ).toBeNull();
  });

  it("rejects identical or malformed languages", () => {
    expect(
      parseTranslationRequest({ ...valid, targetLanguage: "es" })
    ).toBeNull();
    expect(
      parseTranslationRequest({ ...valid, targetLanguage: "EN" })
    ).toBeNull();
    expect(
      parseTranslationRequest({ ...valid, sourceLanguage: "spanish" })
    ).toBeNull();
  });

  it("rejects empty, oversized, duplicated or oddly keyed texts", () => {
    expect(parseTranslationRequest({ ...valid, texts: [] })).toBeNull();
    expect(
      parseTranslationRequest({
        ...valid,
        texts: [{ key: `product:${id}:title`, text: " " }]
      })
    ).toBeNull();
    expect(
      parseTranslationRequest({
        ...valid,
        texts: [
          {
            key: `product:${id}:title`,
            text: "x".repeat(TRANSLATION_LIMITS.maxTextLength + 1)
          }
        ]
      })
    ).toBeNull();
    expect(
      parseTranslationRequest({
        ...valid,
        texts: [valid.texts[0], valid.texts[0]]
      })
    ).toBeNull();
    expect(
      parseTranslationRequest({
        ...valid,
        texts: [{ key: "../../etc/passwd", text: "a" }]
      })
    ).toBeNull();
    expect(
      parseTranslationRequest({
        ...valid,
        texts: Array.from(
          { length: TRANSLATION_LIMITS.maxTexts + 1 },
          (_, n) => ({
            key: `product:a1000000-0000-4000-8000-${String(n).padStart(12, "0")}:title`,
            text: "a"
          })
        )
      })
    ).toBeNull();
    expect(parseTranslationRequest(null)).toBeNull();
  });
});

describe("translation result", () => {
  const request = parseTranslationRequest(valid)!;

  it("accepts exactly the requested keys with trimmed non-empty text", () => {
    expect(
      parseTranslationResult(
        {
          translations: [
            { key: `product:${id}:description`, text: " With fries " },
            { key: `product:${id}:title`, text: "Milanese" }
          ]
        },
        request
      )
    ).toEqual([
      { key: `product:${id}:title`, text: "Milanese" },
      { key: `product:${id}:description`, text: "With fries" }
    ]);
  });

  it("rejects missing, extra, repeated or unsafe results from the provider", () => {
    const one = { key: `product:${id}:title`, text: "Milanese" };
    expect(parseTranslationResult({ translations: [one] }, request)).toBeNull();
    expect(
      parseTranslationResult(
        {
          translations: [
            one,
            { key: `product:${id}:description`, text: "x" },
            { key: `product:${id}:other`, text: "y" }
          ]
        },
        request
      )
    ).toBeNull();
    expect(
      parseTranslationResult({ translations: [one, one] }, request)
    ).toBeNull();
    expect(
      parseTranslationResult(
        {
          translations: [one, { key: `product:${id}:description`, text: "" }]
        },
        request
      )
    ).toBeNull();
    expect(parseTranslationResult("nope", request)).toBeNull();
  });
});
