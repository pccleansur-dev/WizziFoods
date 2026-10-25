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

/** Waits until React attached its handlers to this control: a click before is lost. */
async function hydrated(control: Locator) {
  await expect
    .poll(() =>
      control.evaluate((element) =>
        Object.keys(element).some((key) => key.startsWith("__reactProps"))
      )
    )
    .toBe(true);
}

async function openAccounts(page: Page) {
  await page.goto(`${base}/salon?vista=cuentas`);
  await expect(
    page.getByRole("heading", { name: "Cuentas de mesa" })
  ).toBeVisible();
}

function account(page: Page, table: string) {
  return page.getByRole("article", { name: `Mesa ${table}` });
}

test("three people split a table: one pays two shares and later consumption stays outside them", async ({
  browser
}) => {
  await business.placeOrder("5", ["milanesa", "cerveza"]);
  const ana = await signIn(browser, "ana");
  await openAccounts(ana);
  const card = account(ana, "5");
  await expect(card).toContainText("Pendiente $ 165,00");

  const open = card.getByRole("button", { name: /^Dividir la cuenta/u });
  await hydrated(open);
  await clickUntil(open, () =>
    expect(card.getByLabel("Partes iguales del saldo pendiente")).toBeVisible({
      timeout: 2_000
    })
  );
  await card.getByLabel("Partes iguales del saldo pendiente").fill("3");
  await card.getByRole("button", { name: "Dividir", exact: true }).click();
  const shares = card.getByRole("list", { name: "Partes de la cuenta" });
  await expect(shares).toContainText("Parte 3");
  await expect(shares.locator("b")).toHaveText([
    "$ 55,00",
    "$ 55,00",
    "$ 55,00"
  ]);

  // One payer takes two of the three shares as a single payment.
  await shares.getByLabel("Parte 1").check();
  await shares.getByLabel("Parte 2").check();
  await card.getByLabel("Quién paga (opcional)").fill("Ana");
  await card
    .getByRole("button", { name: "Cobrar 2 partes · $ 110,00" })
    .click();
  await expect(card).toContainText("Pendiente $ 55,00", { timeout: 15_000 });
  await expect(shares).toContainText("pagada por Ana");

  // A later order is new balance; the remaining share keeps its amount.
  await business.placeOrder("5", ["cerveza"]);
  await expect(card).toContainText("Pendiente $ 95,00", { timeout: 15_000 });
  await expect(shares.locator("b").last()).toHaveText("$ 55,00");

  // The third person pays the last share by card; only the new consumption is left.
  await shares.getByLabel("Parte 3").check();
  await card.getByLabel("Quién paga (opcional)").fill("Beto");
  await card
    .getByLabel("Medio de pago de las partes")
    .selectOption("debit_card");
  await expect(card.getByLabel(/número|vencimiento|cvv|cvc/iu)).toHaveCount(0);
  await card.getByRole("button", { name: "Cobrar 1 parte · $ 55,00" }).click();
  await expect(card).toContainText("Pendiente $ 40,00", { timeout: 15_000 });
  await expect(
    card.getByRole("list", { name: "Partes de la cuenta" })
  ).toHaveCount(0);
  const payments = (await business.entries()).filter(
    (entry) => entry.kind === "payment"
  );
  expect(payments.map((entry) => entry.amount)).toEqual([-11_000, -5_500]);
});

test("the waiter splits by consumption, a diner reserves a share from the phone and the waiter collects it", async ({
  browser
}) => {
  await business.placeOrder("6", ["milanesa", "cerveza"]);
  const ana = await signIn(browser, "ana");
  await openAccounts(ana);
  const card = account(ana, "6");
  await expect(card).toContainText("Pendiente $ 165,00");

  const open = card.getByRole("button", { name: /^Dividir la cuenta/u });
  await hydrated(open);
  await clickUntil(open, () =>
    expect(card.getByRole("form", { name: "Dividir por consumo" })).toBeVisible(
      {
        timeout: 2_000
      }
    )
  );
  const byItems = card.getByRole("form", { name: "Dividir por consumo" });
  await byItems.getByLabel(/Milanesa/u).selectOption("1");
  await byItems.getByLabel(/Cerveza/u).selectOption("2");
  await byItems.getByRole("button", { name: "Dividir por consumo" }).click();
  const shares = card.getByRole("list", { name: "Partes de la cuenta" });
  await expect(shares.locator("b")).toHaveText(["$ 125,00", "$ 40,00"]);

  // A diner at that table opens the menu on their own phone and takes share 2.
  const phone = await browser.newContext(
    contextOptions(test.info().project.use)
  );
  contexts.push(phone);
  const diner = await phone.newPage();
  await diner.goto(`${origin}/m/${await business.dinerToken("6")}`);
  const split = diner.getByRole("button", { name: "Dividir la cuenta" });
  await hydrated(split);
  await clickUntil(split, () =>
    expect(
      diner.getByRole("heading", { name: "Tu parte de la cuenta" })
    ).toBeVisible({
      timeout: 2_000
    })
  );
  await diner.getByLabel("Tu nombre").fill("Beto");
  await diner.getByRole("button", { name: "Tomar la parte 2" }).click();
  await expect(diner.getByText("La tomaste vos")).toBeVisible({
    timeout: 15_000
  });
  await expect(
    diner.getByRole("button", { name: "Tomar la parte 1" })
  ).toBeEnabled();
  await expect(diner.getByLabel(/número|vencimiento|cvv|cvc/iu)).toHaveCount(0);

  // The waiter sees who holds it (the screen refreshes by itself) and collects it.
  await expect(shares).toContainText("reservada por Beto", { timeout: 15_000 });
  await shares.getByLabel("Parte 2").check();
  await card.getByRole("button", { name: "Cobrar 1 parte · $ 40,00" }).click();
  await expect(card).toContainText("Pendiente $ 125,00", { timeout: 15_000 });
  await expect(shares).toContainText("pagada por Beto");
  await expect(diner.getByText("Pagada")).toBeVisible({ timeout: 15_000 });
});
