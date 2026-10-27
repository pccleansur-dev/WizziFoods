import { describe, expect, it } from "vitest";

import {
  availableLanguages,
  catalogDescription,
  catalogTitle,
  localizedDescription,
  localizedTitle
} from "./diner-catalog-format";

const content = [
  { description: "Con papas.", language: "es", title: "Milanesa" },
  { description: "With fries.", language: "en", title: "Milanese" },
  { description: "", language: "pt", title: "" }
];

describe("menu language", () => {
  it("shows the language the diner chose and tells which one it is", () => {
    expect(localizedTitle(content, "en")).toEqual({
      language: "en",
      text: "Milanese"
    });
    expect(localizedDescription(content, "en")).toEqual({
      language: "en",
      text: "With fries."
    });
  });

  it("uses the base language of a regional one", () => {
    expect(catalogTitle(content, "en-US")).toBe("Milanese");
  });

  it("falls back to the business's own language when a translation is empty or missing", () => {
    expect(localizedTitle(content, "pt")).toEqual({
      language: "es",
      text: "Milanesa"
    });
    expect(catalogDescription(content, "pt")).toBe("Con papas.");
    expect(catalogTitle(content, "fr")).toBe("Milanesa");
    expect(catalogTitle(content)).toBe("Milanesa");
  });

  it("falls back per field: a translated name with no translated description keeps the original one", () => {
    const partial = [
      { description: "Con papas.", language: "es", title: "Milanesa" },
      { description: "", language: "en", title: "Milanese" }
    ];
    expect(localizedTitle(partial, "en").language).toBe("en");
    expect(localizedDescription(partial, "en")).toEqual({
      language: "es",
      text: "Con papas."
    });
  });

  it("never shows a machine translation nobody approved", () => {
    const draft = [
      ...content.slice(0, 1),
      {
        description: "With fries.",
        language: "en",
        review: "machine" as const,
        title: "Milanese"
      }
    ];
    expect(catalogTitle(draft, "en")).toBe("Milanesa");
    expect(availableLanguages([draft])).toEqual(["es"]);
  });

  it("offers the business's own language first and then the approved ones", () => {
    expect(availableLanguages([content, content])).toEqual(["es", "en"]);
    expect(availableLanguages([])).toEqual([]);
  });

  it("is only words: there is no price or availability in what it reads", () => {
    const withMoney = [
      { ...content[1]!, priceCents: 1, isAvailable: false }
    ] as unknown as typeof content;
    expect(Object.keys(localizedTitle(withMoney, "en")).sort()).toEqual([
      "language",
      "text"
    ]);
  });

  it("never shows a blank for an entry without any text", () => {
    expect(catalogTitle([], "en")).toBe("Sin nombre");
    expect(catalogDescription([], "en")).toBe("");
  });
});
