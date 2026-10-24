import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page
} from "@playwright/test";

import {
  productionHostname,
  productionPin,
  productionSlug,
  seedProductionBusiness,
  type ProductionBusiness
} from "./production-data";
import { webPort } from "./stack-env";

const origin = `http://${productionHostname}:${webPort}`;
const productionUrl = `${origin}/interno/${productionSlug}/operacion/produccion`;
const salonUrl = `${origin}/interno/${productionSlug}/operacion/salon`;

let business: ProductionBusiness;
const contexts: BrowserContext[] = [];

test.describe.configure({ mode: "serial", timeout: 120_000 });

test.beforeAll(async () => {
  business = await seedProductionBusiness();
});

test.afterEach(async () => {
  for (const context of contexts.splice(0)) await context.close();
});

test.afterAll(async () => {
  await business?.close();
});

/** A fresh browser profile signed in with a staff username and PIN. */
async function signIn(browser: Browser, username: string): Promise<Page> {
  const context = await browser.newContext({ ...test.info().project.use });
  contexts.push(context);
  const page = await context.newPage();
  await page.goto(`${origin}/interno/${productionSlug}`);
  await page.getByLabel("Usuario").fill(username);
  await page.getByLabel("PIN de 6 dígitos").fill(productionPin);
  await page.getByRole("button", { name: "Entrar a la operación" }).click();
  await expect(page).toHaveURL(/\/operacion$/u);
  return page;
}

/**
 * Clicks a button until its effect shows. A click that lands before React
 * hydrates the page is lost, and repeating it is safe: every action here is
 * idempotent per command, item and step.
 */
async function clickUntil(button: Locator, done: () => Promise<void>) {
  await expect(async () => {
    if (await button.count()) await button.click({ timeout: 2_000 });
    await done();
  }).toPass({ timeout: 30_000 });
}

function moveItem(ticket: Locator, button: RegExp, shown: string) {
  return clickUntil(ticket.getByRole("button", { name: button }), () =>
    expect(ticket).toContainText(shown, { timeout: 2_000 })
  );
}

test("an order with a kitchen and a bar item reaches each screen, step by step", async ({
  browser
}) => {
  const coco = await signIn(browser, "coco");
  const beto = await signIn(browser, "beto");
  for (const page of [coco, beto]) await page.goto(productionUrl);
  await expect(coco.getByRole("heading", { name: "Cocina" })).toBeVisible();
  await expect(beto.getByRole("heading", { name: "Barra" })).toBeVisible();
  await expect(coco.getByText("Sin pedidos pendientes.")).toBeVisible();

  // The diner orders a dish and a drink; nothing is produced until confirmed.
  const dinerContext = await browser.newContext({
    ...test.info().project.use
  });
  contexts.push(dinerContext);
  const diner = await dinerContext.newPage();
  await diner.goto(`${origin}/m/${business.token}`);
  for (const name of ["Milanesa", "Cerveza"]) {
    await diner.getByRole("button", { name: "Carta", exact: true }).click();
    await diner.getByRole("button", { name: `Ver detalle de ${name}` }).click();
    await diner.getByRole("button", { name: "Agregar a Mi pedido" }).click();
  }
  await diner.getByRole("button", { name: "Continuar" }).click();
  await diner.getByLabel("Tu nombre").fill("Valentín");
  await diner.getByRole("button", { name: "Enviar pedido" }).click();
  await expect(
    diner.getByRole("heading", { name: "Ya avisamos al mozo" })
  ).toBeVisible();

  await coco.reload();
  await expect(coco.getByText("Sin pedidos pendientes.")).toBeVisible();
  expect(await business.counts()).toEqual({ events: 0, items: 0 });

  // The waiter confirms it.
  const ana = await signIn(browser, "ana");
  await ana.goto(salonUrl);
  const card = ana.getByRole("article", { name: "Mesa 5 · Valentín" });
  await clickUntil(
    card.getByRole("button", { name: "Tomar llamado de mesa 5" }),
    () => expect(card).toContainText("Lo estás atendiendo", { timeout: 2_000 })
  );
  await clickUntil(
    card.getByRole("button", { name: "Confirmar pedido de mesa 5" }),
    () =>
      expect(
        ana.getByRole("region", { name: "Pedido confirmado · Mesa 5" })
      ).toBeVisible({ timeout: 2_000 })
  );
  expect((await business.counts()).items).toBe(2);

  // Each screen shows only its own item.
  await coco.reload();
  await beto.reload();
  const kitchenTicket = coco.locator(".waiter-card", { hasText: "Mesa 5" });
  const barTicket = beto.locator(".waiter-card", { hasText: "Mesa 5" });
  await expect(kitchenTicket).toContainText("Milanesa");
  await expect(kitchenTicket).not.toContainText("Cerveza");
  await expect(barTicket).toContainText("Cerveza");
  await expect(barTicket).not.toContainText("Milanesa");
  await expect(kitchenTicket).toContainText("En cola");

  // The kitchen moves its item through the steps; a reload never repeats them.
  await moveItem(
    kitchenTicket,
    /^Empezar a preparar: .*Milanesa/u,
    "Milanesa · En preparación"
  );
  await expect(kitchenTicket).toContainText("Pedido completo: En preparación");
  await coco.reload();
  await expect(kitchenTicket).toContainText("En preparación");
  await moveItem(
    kitchenTicket,
    /^Marcar listo: .*Milanesa/u,
    "Milanesa · Listo"
  );
  await expect(kitchenTicket.locator(".waiter-chip")).toHaveText("Listo");
  await expect(kitchenTicket.getByRole("button")).toHaveCount(0);
  await expect(kitchenTicket).toContainText("Pedido completo: En preparación");
  expect(await business.counts()).toEqual({ events: 2, items: 2 });

  // The bar item is independent and finishes the order.
  await expect(barTicket).toContainText("En cola");
  await moveItem(
    barTicket,
    /^Empezar a preparar: .*Cerveza/u,
    "Cerveza · En preparación"
  );
  await moveItem(barTicket, /^Marcar listo: .*Cerveza/u, "Cerveza · Listo");
  await expect(barTicket).toContainText("Pedido completo: Listo");
  await coco.reload();
  await expect(kitchenTicket).toContainText("Pedido completo: Listo");
  expect(await business.counts()).toEqual({ events: 4, items: 2 });
});

test("only production staff reach the screen, and the salon stays closed to them", async ({
  browser
}) => {
  for (const username of ["ana", "marta"]) {
    const page = await signIn(browser, username);
    await page.goto(productionUrl);
    await expect(page).toHaveURL(/\/operacion$/u);
    const response = await page.request.get(`${productionUrl}/vista`);
    expect(response.status()).toBe(403);
  }
  const coco = await signIn(browser, "coco");
  await coco.goto(salonUrl);
  await expect(coco).toHaveURL(/\/operacion$/u);
  await expect(coco.getByRole("link", { name: "Abrir Cocina" })).toBeVisible();
});

test("the production screen fits the screen and every control has an accessible name", async ({
  browser
}) => {
  const coco = await signIn(browser, "coco");
  await coco.goto(productionUrl);
  await expect(coco.getByRole("heading", { name: "Cocina" })).toBeVisible();
  const overflow = await coco.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);
  const unnamed = await coco.evaluate(() =>
    [...document.querySelectorAll("button, a, input, select, textarea")]
      .filter((element) => {
        const input = element as HTMLInputElement;
        if (input.type === "hidden") return false;
        const label =
          element.getAttribute("aria-label") ?? element.textContent?.trim();
        return !label;
      })
      .map((element) => element.outerHTML.slice(0, 80))
  );
  expect(unnamed).toEqual([]);
});
