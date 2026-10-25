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
  adjustmentsSlug,
  seedAdjustmentsBusiness,
  type AdjustmentsBusiness
} from "./adjustments-data";
import { webPort } from "./stack-env";
import { contextOptions } from "./stack-env";

const origin = `http://${adjustmentsHostname}:${webPort}`;
const base = `${origin}/interno/${adjustmentsSlug}/operacion`;

let business: AdjustmentsBusiness;
const contexts: BrowserContext[] = [];

test.describe.configure({ mode: "serial", timeout: 150_000 });

test.beforeAll(async () => {
  business = await seedAdjustmentsBusiness();
});

test.afterEach(async () => {
  for (const context of contexts.splice(0)) await context.close();
});

test.afterAll(async () => {
  await business?.close();
});

/** A fresh browser profile signed in with a staff username and PIN. */
async function signIn(browser: Browser, username: string): Promise<Page> {
  const context = await browser.newContext(
    contextOptions(test.info().project.use)
  );
  contexts.push(context);
  const page = await context.newPage();
  await page.goto(`${origin}/interno/${adjustmentsSlug}`);
  await page.getByLabel("Usuario").fill(username);
  await page.getByLabel("PIN de 6 dígitos").fill(adjustmentsPin);
  await page.getByRole("button", { name: "Entrar a la operación" }).click();
  await expect(page).toHaveURL(/\/operacion$/u);
  return page;
}

/**
 * Clicks until the effect shows. A click that lands before React hydrates the
 * page is lost; repeating it is safe because every action is idempotent.
 */
async function clickUntil(button: Locator, done: () => Promise<void>) {
  await expect(async () => {
    // The effect may already be there (a slow response, a button that is now
    // disabled): check it before clicking again.
    const already = await done().then(
      () => true,
      () => false
    );
    if (already) return;
    if (await button.count()) {
      await button.click({ timeout: 2_000 }).catch(() => undefined);
    }
    await done();
  }).toPass({ timeout: 30_000 });
}

async function openOrders(page: Page) {
  await page.goto(`${base}/salon?vista=pedidos`);
  await expect(
    page.getByRole("heading", { name: "Pedidos en curso" })
  ).toBeVisible();
}

function ticket(page: Page, table: string) {
  return page.locator(".waiter-card", { hasText: `Mesa ${table}` });
}

function row(scope: Locator, title: string) {
  // Anchored: a replaced item also mentions its replacement in its own text.
  return scope
    .locator("li")
    .filter({ hasText: new RegExp(String.raw`^\d+ × ${title}`, "u") });
}

async function production(browser: Browser, username: string): Promise<Page> {
  const page = await signIn(browser, username);
  await page.goto(`${base}/produccion`);
  return page;
}

/** Kitchen or Bar finishes an item from its own screen. */
async function prepare(page: Page, table: string, title: string) {
  const scope = ticket(page, table);
  await clickUntil(
    scope.getByRole("button", {
      name: new RegExp(`^Empezar a preparar: .*${title}`, "u")
    }),
    () =>
      expect(row(scope, title)).toContainText("En preparación", {
        timeout: 2_000
      })
  );
  await clickUntil(
    scope.getByRole("button", {
      name: new RegExp(`^Marcar listo: .*${title}`, "u")
    }),
    () => expect(row(scope, title)).toContainText("Listo", { timeout: 2_000 })
  );
}

async function reportShortage(
  page: Page,
  table: string,
  title: string,
  reason: string
) {
  const scope = ticket(page, table);
  await clickUntil(
    scope.getByRole("button", {
      name: new RegExp(`^Informar faltante: .*${title}`, "u")
    }),
    () =>
      expect(scope.getByLabel("Motivo del faltante (obligatorio)")).toBeVisible(
        { timeout: 2_000 }
      )
  );
  await scope.getByLabel("Motivo del faltante (obligatorio)").fill(reason);
  await scope
    .getByRole("button", { name: "Informar faltante", exact: true })
    .click();
  await expect(row(scope, title)).toContainText("Faltante", {
    timeout: 15_000
  });
}

test("a shortage becomes an accepted replacement and the order ends delivered", async ({
  browser
}) => {
  await business.placeOrder("5", ["milanesa", "cerveza"]);
  const coco = await production(browser, "coco");
  const beto = await production(browser, "beto");
  await prepare(coco, "5", "Milanesa");
  await reportShortage(beto, "5", "Cerveza", "Se terminó la cerveza");

  const ana = await signIn(browser, "ana");
  await openOrders(ana);
  const order = ticket(ana, "5");
  await expect(order).toContainText("Hay un faltante");
  await expect(row(order, "Cerveza")).toContainText(
    "Faltante: Se terminó la cerveza"
  );
  // A waiter cannot cancel: that is the manager's decision.
  await expect(
    order.getByRole("button", { name: /^Cancelar ítem/u })
  ).toHaveCount(0);

  await clickUntil(
    order.getByRole("button", { name: /^Entregar: .*Milanesa/u }),
    () =>
      expect(row(order, "Milanesa")).toContainText("Entregado", {
        timeout: 2_000
      })
  );

  const proposeButton = order.getByRole("button", {
    name: /^Proponer reemplazo: .*Cerveza/u
  });
  await clickUntil(proposeButton, () =>
    expect(order.getByLabel("Producto de reemplazo")).toBeVisible({
      timeout: 2_000
    })
  );
  const picker = order.getByLabel("Producto de reemplazo");
  const wine = await picker
    .locator("option", { hasText: "Vino" })
    .first()
    .getAttribute("value");
  await picker.selectOption(wine!);
  await order.getByRole("button", { name: "Proponer al comensal" }).click();
  await expect(row(order, "Cerveza")).toContainText(
    "Reemplazo propuesto: Vino",
    {
      timeout: 15_000
    }
  );
  await expect(row(order, "Cerveza")).toContainText("Suma");

  await clickUntil(
    order.getByRole("button", {
      name: /^El comensal acepta el reemplazo: .*Cerveza/u
    }),
    () =>
      expect(row(order, "Cerveza")).toContainText("Reemplazado", {
        timeout: 2_000
      })
  );
  await expect(row(order, "Vino")).toContainText("En cola");
  expect(await business.adjustments()).toEqual([
    { difference: 2_900, kind: "replacement", status: "accepted" }
  ]);

  // The bar prepares the replacement and the waiter delivers it.
  await beto.reload();
  await prepare(beto, "5", "Vino");
  await ana.reload();
  await ana.getByRole("button", { name: "Pedidos en curso" }).click();
  const again = ticket(ana, "5");
  await clickUntil(
    again.getByRole("button", { name: /^Entregar: .*Vino/u }),
    () =>
      expect(
        ana.getByText("No hay pedidos en curso en tus mesas.")
      ).toBeVisible({ timeout: 2_000 })
  );
});

test("a shortage with no replacement is cancelled by the manager only", async ({
  browser
}) => {
  await business.placeOrder("6", ["pollo", "cerveza"]);
  const coco = await production(browser, "coco");
  await reportShortage(coco, "6", "Pollo", "Se quemó");

  const ana = await signIn(browser, "ana");
  await openOrders(ana);
  const asWaiter = ticket(ana, "6");
  await expect(row(asWaiter, "Pollo")).toContainText("Faltante: Se quemó");
  await expect(
    asWaiter.getByRole("button", { name: /^Cancelar ítem/u })
  ).toHaveCount(0);

  const marta = await signIn(browser, "marta");
  await openOrders(marta);
  const asManager = ticket(marta, "6");
  await clickUntil(
    asManager.getByRole("button", { name: /^Cancelar ítem: .*Pollo/u }),
    () =>
      expect(
        asManager.getByLabel("Motivo de la cancelación (obligatorio)")
      ).toBeVisible({ timeout: 2_000 })
  );
  const confirm = asManager.getByRole("button", {
    name: "Confirmar cancelación"
  });
  await expect(confirm).toBeDisabled();
  await asManager
    .getByLabel("Motivo de la cancelación (obligatorio)")
    .fill("Sin reemplazo");
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(row(asManager, "Pollo")).toContainText("Cancelado", {
    timeout: 15_000
  });
  await expect(row(asManager, "Cerveza")).toContainText("En cola");
  expect(await business.adjustments()).toContainEqual({
    difference: -9_000,
    kind: "cancellation",
    status: "accepted"
  });
});

test("the orders screen fits the screen and every control has an accessible name", async ({
  browser
}) => {
  await business.placeOrder("5", ["milanesa"]);
  const marta = await signIn(browser, "marta");
  await openOrders(marta);
  await expect(ticket(marta, "5").first()).toBeVisible();
  const overflow = await marta.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);
  const unnamed = await marta.evaluate(() =>
    [...document.querySelectorAll("button, a, input, select, textarea")]
      .filter((element) => {
        const input = element as HTMLInputElement;
        if (input.type === "hidden") return false;
        const label =
          element.getAttribute("aria-label") ??
          element.textContent?.trim() ??
          (input.labels && input.labels.length > 0 ? "labelled" : "");
        return !label;
      })
      .map((element) => element.outerHTML.slice(0, 80))
  );
  expect(unnamed).toEqual([]);
});
