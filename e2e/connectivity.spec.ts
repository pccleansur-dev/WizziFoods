import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page
} from "@playwright/test";

import {
  adjustmentsHostname,
  adjustmentsPin,
  adjustmentsSlug
} from "./adjustments-data";
import {
  seedConnectivityBusiness,
  type ConnectivityBusiness
} from "./connectivity-data";
import { contextOptions, webPort } from "./stack-env";

const origin = `http://${adjustmentsHostname}:${webPort}`;
const board = `${origin}/interno/${adjustmentsSlug}/operacion/produccion`;

let business: ConnectivityBusiness;
const contexts: BrowserContext[] = [];

test.describe.configure({ mode: "serial", timeout: 180_000 });

test.beforeAll(async () => {
  business = await seedConnectivityBusiness();
});

test.afterEach(async () => {
  for (const context of contexts.splice(0)) await context.close();
});

test.afterAll(async () => {
  await business?.close();
});

async function kitchen(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    ...contextOptions(test.info().project.use),
    baseURL: origin
  });
  contexts.push(context);
  const page = await context.newPage();
  await page.goto(`${origin}/interno/${adjustmentsSlug}`);
  await page.getByLabel("Usuario").fill("coco");
  await page.getByLabel("PIN de 6 dígitos").fill(adjustmentsPin);
  await page.getByRole("button", { name: "Entrar a la operación" }).click();
  await expect(page).toHaveURL(/\/operacion$/u);
  await page.goto(board);
  await expect(page.getByRole("heading", { name: "Cocina" })).toBeVisible();
  return page;
}

const status = (page: Page) => page.locator("[data-live-status]").first();
const live = (page: Page) =>
  expect(status(page)).toHaveAttribute("data-live-status", "live", {
    timeout: 30_000
  });
const tickets = (page: Page) => page.locator(".waiter-card");
const start = (page: Page) =>
  page.getByRole("button", { name: /^Empezar a preparar/u }).first();

async function hydrated(control: Locator) {
  await expect
    .poll(() =>
      control.evaluate((element) =>
        Object.keys(element).some((key) => key.startsWith("__reactProps"))
      )
    )
    .toBe(true);
}

test("the kitchen hears a new order at once, through Realtime", async ({
  browser
}) => {
  const page = await kitchen(browser);
  await live(page);
  await expect(page.getByText("Sin pedidos pendientes.")).toBeVisible();
  // The heartbeat is a minute: seeing it within seconds means the push got through.
  await business.placeOrder("5", ["milanesa"]);
  await expect(tickets(page)).toHaveCount(1, { timeout: 10_000 });
  await expect(tickets(page).first()).toContainText("Milanesa");
});

test("offline it says so and sends nothing, and on every return it asks the server again", async ({
  browser
}) => {
  const page = await kitchen(browser);
  const context = page.context();
  await live(page);
  const initial = await tickets(page).count();
  const table = ["6", "5", "6"] as const;

  for (let cycle = 0; cycle < 3; cycle += 1) {
    await context.setOffline(true);
    await expect(status(page)).toHaveAttribute("data-live-status", "offline");
    await expect(
      page.getByText(/^Sin conexión\. Estás viendo la última información/u)
    ).toBeVisible();

    // The restaurant keeps working: the screen cannot know, and does not pretend to.
    await business.placeOrder(table[cycle]!, ["milanesa"]);
    await page.waitForTimeout(1_200);
    await expect(tickets(page)).toHaveCount(initial + cycle);

    // Nothing that changes something leaves, and the screen does not claim it did.
    await hydrated(start(page));
    await start(page).click();
    await expect(
      page.getByText(/^Sin conexión: no se envió nada\./u)
    ).toBeVisible();
    expect((await business.itemStatuses()).every((s) => s === "queued")).toBe(
      true
    );

    // Back online: the state is fetched again, with no reload and no click.
    await context.setOffline(false);
    await live(page);
    await expect(tickets(page)).toHaveCount(initial + cycle + 1, {
      timeout: 15_000
    });
    await expect(page.getByText(/^Sin conexión\./u)).toHaveCount(0);
  }
});

test("a server that fails or answers slowly never passes for current", async ({
  browser
}) => {
  const page = await kitchen(browser);
  await live(page);
  const before = await tickets(page).count();

  // Failing: the screen admits it cannot be trusted and recovers by itself.
  await page.route("**/operacion/produccion/vista", (route) =>
    route.fulfill({
      body: "null",
      contentType: "application/json",
      status: 503
    })
  );
  await business.placeOrder("5", ["pollo"]);
  await expect(status(page)).toHaveAttribute(
    "data-live-status",
    "reconnecting",
    {
      timeout: 15_000
    }
  );
  await expect(
    page.getByText(/^No podemos comunicarnos con el servidor/u)
  ).toBeVisible();
  await page.unroute("**/operacion/produccion/vista");
  await expect(status(page)).toHaveAttribute("data-live-status", "live", {
    timeout: 20_000
  });
  await expect(tickets(page)).toHaveCount(before + 1);

  // Slow: the answer is awaited, without a false alarm.
  await page.route("**/operacion/produccion/vista", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    await route.continue();
  });
  await business.placeOrder("6", ["pollo"]);
  await expect(tickets(page)).toHaveCount(before + 2, { timeout: 15_000 });
  await expect(page.getByText(/^No podemos comunicarnos/u)).toHaveCount(0);
  await page.unroute("**/operacion/produccion/vista");
});

test("a lost answer is retried with the same command and nothing happens twice", async ({
  browser
}) => {
  const page = await kitchen(browser);
  await live(page);
  const statuses = await business.itemStatuses();
  expect(statuses.length).toBeGreaterThan(0);
  const before = await business.transitions();

  // The server does the work, but the answer never reaches the screen.
  let dropped = 0;
  await page.route("**/operacion/produccion", async (route) => {
    const request = route.request();
    if (
      request.method() === "POST" &&
      request.headers()["next-action"] &&
      dropped === 0
    ) {
      dropped += 1;
      await route.fetch();
      await route.abort("connectionreset");
      return;
    }
    await route.continue();
  });
  const button = start(page);
  await hydrated(button);
  await button.click();
  await expect(
    page.getByText(/^No pudimos confirmar si se envió\./u)
  ).toBeVisible({ timeout: 15_000 });
  expect(dropped).toBe(1);
  expect(await business.transitions()).toEqual({
    commands: before.commands + 1,
    events: before.events + 1
  });

  // The retry reuses the command: the server answers with what it already did.
  await start(page).click();
  await expect(page.getByText(/En preparación/u).first()).toBeVisible({
    timeout: 15_000
  });
  expect(await business.transitions()).toEqual({
    commands: before.commands + 1,
    events: before.events + 1
  });
});
