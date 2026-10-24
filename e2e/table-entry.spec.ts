import { expect, test } from "@playwright/test";

import {
  otherHostname,
  seedBusiness,
  tables,
  type SeededBusiness
} from "./table-entry-data";
import { webPort } from "./stack-env";

let business: SeededBusiness;

test.beforeAll(async () => {
  business = await seedBusiness();
});

test.afterAll(async () => {
  await business.close();
});

/** Scanning a QR opens exactly the URL it encodes. */
async function scan(page: import("@playwright/test").Page, label: string) {
  await page.goto(`/m/${business.tokens.get(label)!}`);
}

test("a free table lets the diner start", async ({ page }) => {
  await scan(page, "5");
  await expect(page.getByRole("heading", { name: "Mesa 5" })).toBeVisible();
  await expect(page.getByText("Terraza", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Hacer el pedido", { exact: true })
  ).toBeVisible();
});

test("every table of a group joins the open party and names the group", async ({
  page
}) => {
  for (const label of ["17", "18"]) {
    await scan(page, label);
    await expect(
      page.getByText("Estás en Cumpleaños (mesas 17 y 18)")
    ).toBeVisible();
    await expect(page.getByText("te sumás al pedido")).toBeVisible();
  }
});

for (const [label, text] of [
  ["9", "Estamos preparando esta mesa"],
  ["3", "Esta mesa no está disponible"]
] as const) {
  test(`table ${label} only offers the menu and the waiter`, async ({
    page
  }) => {
    await scan(page, label);
    await expect(page.getByText(text)).toBeVisible();
    await expect(page.getByText("El pedido lo toma el mozo")).toBeVisible();
    await expect(
      page.getByText("Hacer el pedido", { exact: true })
    ).toHaveCount(0);
  });
}

test("an unknown token and another business's token get the same safe exit", async ({
  page
}) => {
  await page.goto(`/m/${"0".repeat(64)}`);
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "No reconocemos este código"
  );
  await page.goto(
    `http://${otherHostname}:${webPort}/m/${business.tokens.get("5")!}`
  );
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "No reconocemos este código"
  );
  await page.goto("/m/not-a-token");
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "No reconocemos este código"
  );
});

test("an unknown business shows an unavailable page without hints", async ({
  page
}) => {
  await page.goto(
    `http://nadie-e2e.localhost:${webPort}/m/${business.tokens.get("5")!}`
  );
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "Local no disponible"
  );
});

test("the page does not expose the token, is not indexed and fits the screen", async ({
  page
}) => {
  await scan(page, "5");
  const token = business.tokens.get("5")!;
  expect(await page.locator("main").innerText()).not.toContain(token);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    /noindex/u
  );
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("an open page follows a table that changes state", async ({ page }) => {
  await page.clock.install();
  await scan(page, "5");
  await expect(
    page.getByText("Hacer el pedido", { exact: true })
  ).toBeVisible();
  await business.setState(tables.free, "out_of_service");
  try {
    await page.clock.fastForward(16_000);
    await expect(page.getByText("Esta mesa no está disponible")).toBeVisible();
    await expect(
      page.getByText("Hacer el pedido", { exact: true })
    ).toHaveCount(0);
  } finally {
    await business.setState(tables.free, null);
  }
});
