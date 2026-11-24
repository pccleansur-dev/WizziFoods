import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page
} from "@playwright/test";
import type { DinerWaiterCallReason } from "@platform/contracts";

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

function callResponse(page: Page, reason: DinerWaiterCallReason) {
  return page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/waiter-calls" &&
      response.request().method() === "POST" &&
      response.request().postDataJSON()?.reason === reason
  );
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
  const firstCall = callResponse(diner, "call_waiter");
  await panel.getByRole("button", { name: "Llamar al mozo" }).click();
  const firstResponse = await firstCall;
  expect(firstResponse.ok()).toBe(true);
  const { data: first } = await firstResponse.json();
  expect(first.created).toBe(true);
  await expect(panel.getByRole("status")).toContainText(
    "Avisamos al mozo. Ya viene."
  );
  // Asking again does not pile up calls.
  const duplicateCall = callResponse(diner, "call_waiter");
  await panel.getByRole("button", { name: "Llamar al mozo" }).click();
  const duplicateResponse = await duplicateCall;
  expect(duplicateResponse.ok()).toBe(true);
  expect((await duplicateResponse.json()).data).toMatchObject({
    callId: first.callId,
    created: false
  });
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

  // After a reload on a slow connection, SSR must not accept a click before
  // React is ready. The first click after hydration must reach the server.
  const scripts = /\/_next\/static\/.*\.js(?:\?|$)/u;
  let releaseScripts!: () => void;
  const pendingScripts = new Promise<void>((resolve) => {
    releaseScripts = resolve;
  });
  await diner.route(scripts, async (route) => {
    await pendingScripts;
    await route.continue();
  });
  const callWaiter = panel.getByRole("button", { name: "Llamar al mozo" });
  try {
    await diner.reload({ waitUntil: "commit" });
    await expect(callWaiter).toBeDisabled();
    await expect(panel.getByRole("status")).toContainText("Preparando");
  } finally {
    releaseScripts();
  }
  await expect(callWaiter).toBeEnabled();
  await diner.unroute(scripts);
  const secondCall = callResponse(diner, "call_waiter");
  await callWaiter.click();
  const secondResponse = await secondCall;
  expect(secondResponse.ok()).toBe(true);
  const { data: second } = await secondResponse.json();
  expect(second).toMatchObject({ created: true, reason: "call_waiter" });
  expect(second.callId).not.toBe(first.callId);
  await expect(panel.getByRole("status")).toContainText("Avisamos al mozo");
  await expect(
    ana.getByRole("article", { name: "Mesa 1 · Llama al mozo" })
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
