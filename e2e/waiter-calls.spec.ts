import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page
} from "@playwright/test";

import { contextOptions, webPort } from "./stack-env";
import {
  seedWaiterBusiness,
  staffPin,
  waiterHostname,
  waiterSlug,
  type WaiterBusiness
} from "./waiter-data";

const origin = `http://${waiterHostname}:${webPort}`;
const salonUrl = `${origin}/interno/${waiterSlug}/operacion/salon`;

let business: WaiterBusiness;
const contexts: BrowserContext[] = [];

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  business = await seedWaiterBusiness();
});

test.afterEach(async () => {
  for (const context of contexts.splice(0)) await context.close();
});

test.afterAll(async () => {
  await business?.close();
});

async function freshPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext(
    contextOptions(test.info().project.use)
  );
  contexts.push(context);
  return context.newPage();
}

async function signIn(browser: Browser, username: string): Promise<Page> {
  const page = await freshPage(browser);
  await page.goto(`${origin}/interno/${waiterSlug}`);
  await page.getByLabel("Usuario").fill(username);
  await page.getByLabel("PIN de 6 dígitos").fill(staffPin);
  await page.getByRole("button", { name: "Entrar a la operación" }).click();
  await expect(page).toHaveURL(/\/operacion$/u);
  return page;
}

test("the diner calls the waiter, the staff is told and resolves it", async ({
  browser
}) => {
  const ana = await signIn(browser, "ana");
  await ana.goto(salonUrl);
  await expect(ana.getByText("Sin llamados abiertos.")).toBeVisible();
  await expect(ana).not.toHaveTitle(/^\(\d+\)/u);

  const diner = await freshPage(browser);
  await diner.goto(`${origin}/m/${business.tokens.get("1")!}`);
  const panel = diner.getByRole("region", { name: "¿Necesitás al mozo?" });
  await expect(panel).toBeVisible();
  // A table nobody opened has no bill to ask for.
  await expect(
    panel.getByRole("button", { name: "Pedir la cuenta" })
  ).toHaveCount(0);
  await panel.getByRole("button", { name: "Llamar al mozo" }).click();
  await expect(panel.getByRole("status")).toContainText(
    "Avisamos al mozo. Ya viene."
  );
  // Asking again does not pile up calls.
  await panel.getByRole("button", { name: "Llamar al mozo" }).click();
  await expect(panel.getByRole("status")).toContainText("Ya viene");

  // The staff screen learns about it by itself and warns in the tab title.
  const card = ana.getByRole("article", { name: "Mesa 1 · Llama al mozo" });
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card).toContainText("Sin atender");
  await expect(ana).toHaveTitle(/^\(1\) /u);
  await expect(ana.locator(".waiter-status")).toContainText("1 sin atender");
  await expect(
    ana.getByRole("article", { name: /Mesa 1 · Llama al mozo/u })
  ).toHaveCount(1);

  await card.getByRole("button", { name: "Tomar llamado de mesa 1" }).click();
  await expect(card).toContainText("Lo estás atendiendo");
  await expect(ana).not.toHaveTitle(/^\(\d+\)/u);
  await card
    .getByRole("button", { name: "Resolver llamado de mesa 1" })
    .click();
  await expect(card).toHaveCount(0);

  // After being resolved the diner can call again and it is a new call.
  await panel.getByRole("button", { name: "Necesito ayuda" }).click();
  await expect(panel.getByRole("status")).toContainText("necesitás ayuda");
  await expect(
    ana.getByRole("article", { name: "Mesa 1 · Pide ayuda" })
  ).toBeVisible({ timeout: 15_000 });
});

test("the staff can silence the alert on this device", async ({ browser }) => {
  const ana = await signIn(browser, "ana");
  await ana.goto(salonUrl);
  const toggle = ana.getByRole("button", { name: /^Aviso de llamados/u });
  await expect(toggle).toContainText("con sonido y vibración");
  await toggle.click();
  await expect(toggle).toContainText("silenciado en este dispositivo");
  await ana.reload();
  await expect(
    ana.getByRole("button", { name: /^Aviso de llamados/u })
  ).toContainText("silenciado");
});
