import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { adjustmentsHostname, adjustmentsPin, adjustmentsSlug } from "./adjustments-data";
import {
  seedConnectivityBusiness,
  type ConnectivityBusiness
} from "./connectivity-data";
import { contextOptions, webPort } from "./stack-env";

const origin = `http://${adjustmentsHostname}:${webPort}`;

let business: ConnectivityBusiness;
const contexts: BrowserContext[] = [];

test.describe.configure({ mode: "serial", timeout: 120_000 });

test.beforeAll(async () => {
  business = await seedConnectivityBusiness();
});

test.afterEach(async () => {
  for (const context of contexts.splice(0)) await context.close();
});

test.afterAll(async () => {
  await business?.close();
});

/** URLs of everything the worker has stored, per cache. */
async function stored(page: Page): Promise<Record<string, string[]>> {
  return page.evaluate(async () => {
    const result: Record<string, string[]> = {};
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      result[name] = (await cache.keys()).map((request) => request.url);
    }
    return result;
  });
}

async function controlled(page: Page) {
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await expect
    .poll(() =>
      page.evaluate(() => Boolean(navigator.serviceWorker.controller))
    )
    .toBe(true);
}

test("production: the worker caches the build and the last menu, never a private screen", async ({
  browser
}) => {
  const context = await browser.newContext({
    ...contextOptions(test.info().project.use),
    baseURL: origin
  });
  contexts.push(context);
  const page = await context.newPage();

  await page.goto(`${origin}/m/${business.token}`);
  await expect(
    page.getByRole("button", { name: "Carta", exact: true })
  ).toBeVisible();
  await controlled(page);
  await expect(
    page.getByRole("button", { name: "Carta", exact: true })
  ).toBeVisible();

  // The registration asked for caching (production) and the worker stored the pieces.
  await expect
    .poll(async () => (await stored(page))["reads-v1"]?.length ?? 0)
    .toBeGreaterThan(0);
  const first = await stored(page);
  expect(first["reads-v1"]!.every((url) => url.includes("/m/"))).toBe(true);
  expect(
    first["shell-v1"]!.some((url) => url.includes("/_next/static/"))
  ).toBe(true);
  expect(first["shell-v1"]!.some((url) => url.endsWith("/offline.html"))).toBe(
    true
  );

  // Offline: the last menu is shown, says it may be old, and sending is blocked.
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Carta", exact: true })
  ).toBeVisible();
  await expect(
    page.getByText(/^Sin conexión\. Lo que ves puede estar desactualizado/u)
  ).toBeVisible();

  // Back online: what the device remembered is forgotten and the menu is asked again.
  await context.setOffline(false);
  await expect(page.getByText(/^Sin conexión\./u)).toHaveCount(0);
  await expect
    .poll(async () => (await stored(page))["reads-v1"]?.length ?? 0)
    .toBe(0);

  // A staff screen never reaches any cache.
  await page.goto(`${origin}/interno/${adjustmentsSlug}`);
  await page.getByLabel("Usuario").fill("coco");
  await page.getByLabel("PIN de 6 dígitos").fill(adjustmentsPin);
  await page.getByRole("button", { name: "Entrar a la operación" }).click();
  await expect(page).toHaveURL(/\/operacion$/u);
  await page.goto(`${origin}/interno/${adjustmentsSlug}/operacion/produccion`);
  await expect(page.getByRole("heading", { name: "Cocina" })).toBeVisible();
  // Build files are public code; what must never be there is a page or an answer.
  const all = Object.values(await stored(page))
    .flat()
    .filter((url) => !url.includes("/_next/static/"));
  expect(
    all.filter((url) => /\/interno\/|\/api\/|\/cuenta|\/panel/u.test(url))
  ).toEqual([]);

  // Offline on a private screen: the offline page, never old private data.
  await context.setOffline(true);
  await page.reload().catch(() => undefined);
  await expect(page.getByRole("heading", { name: "Sin conexión" })).toBeVisible();
  await context.setOffline(false);
});
