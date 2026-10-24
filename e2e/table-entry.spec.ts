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
  await business?.close();
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

test("the diner navigates the menu and keeps a private draft per device", async ({
  browser,
  page
}) => {
  await scan(page, "5");
  await page.getByRole("button", { name: "Ver detalle de Milanesa" }).click();
  await expect(page.getByRole("dialog")).toContainText("Con papas doradas");
  await page.getByLabel("Napolitana").check();
  await page.getByLabel("Cantidad", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Agregar a Mi pedido" }).click();
  await expect(page.getByRole("heading", { name: "Mi pedido" })).toBeVisible();
  await expect(page.getByText("Napolitana", { exact: true })).toBeVisible();
  await expect(page.locator(".diner-total")).toContainText("300,00");

  const otherDevice = await browser.newContext({
    baseURL: test.info().project.use.baseURL!,
    viewport: { height: 812, width: 375 }
  });
  try {
    const otherPage = await otherDevice.newPage();
    await otherPage.goto(`/m/${business.tokens.get("5")!}`);
    await otherPage.getByRole("button", { name: /Mi pedido/u }).click();
    await expect(
      otherPage.getByRole("heading", { name: "Tu pedido está vacío" })
    ).toBeVisible();
  } finally {
    await otherDevice.close();
  }
});

test("a concurrent availability change marks the draft and blocks continuation", async ({
  page
}) => {
  await page.clock.install();
  await scan(page, "5");
  await page.getByRole("button", { name: "Ver detalle de Milanesa" }).click();
  await page.getByRole("button", { name: "Agregar a Mi pedido" }).click();
  await expect(page.getByRole("button", { name: "Continuar" })).toBeEnabled();
  await business.setProductAvailable(false);
  try {
    await page.clock.fastForward(16_000);
    await expect(page.getByText("No está disponible ahora.")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Continuar" })
    ).toBeDisabled();
  } finally {
    await business.setProductAvailable(true);
  }
});
