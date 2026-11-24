import { describe, expect, it } from "vitest";
import { searchWaiterMenu } from "./menu-search";

const menu = [
  {
    id: "1",
    title: "Café con leche",
    categoryTitle: "Cafetería",
    priceCents: 100,
    variants: [{ id: "2", title: "Grande", priceDeltaCents: 20 }]
  },
  {
    id: "3",
    title: "Milanesa",
    categoryTitle: "Platos",
    priceCents: 200,
    variants: []
  }
];

describe("searchWaiterMenu", () => {
  it("finds products by words from the title, category and variant without accents", () => {
    expect(searchWaiterMenu(menu, "  CAFE grande ")).toEqual([menu[0]]);
    expect(searchWaiterMenu(menu, "platos")).toEqual([menu[1]]);
    expect(searchWaiterMenu(menu, "cafe milanesa")).toEqual([]);
  });
});
