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

test("a confirmed order opens the account, occupies the table and is collected with a tip", async ({
  browser
}) => {
  const ana = await signIn(browser, "ana");
  await ana.goto(`${base}/salon?vista=comanda`);
  await expect(
    ana.getByRole("heading", { name: "Cargar comanda" })
  ).toBeVisible();
  await hydrated(ana.getByRole("button", { name: "Agregar Milanesa" }));
  await ana
    .getByLabel("Mesa", { exact: true })
    .selectOption({ label: "Mesa 5" });
  await ana.getByRole("button", { name: "Agregar Milanesa" }).click();
  await ana.getByRole("button", { name: "Agregar Cerveza" }).click();
  const confirmed = ana.getByRole("region", {
    name: "Pedido confirmado · Mesa 5"
  });
  await clickUntil(ana.getByRole("button", { name: "Confirmar comanda" }), () =>
    expect(confirmed).toBeVisible({ timeout: 2_000 })
  );

  // The order is already on the table's account; nothing was collected.
  await expect(confirmed).toContainText("Pendiente $ 165,00");
  await expect(confirmed).toContainText("no registrado");
  expect((await business.entries()).map((entry) => entry.kind)).toEqual([
    "charge",
    "charge"
  ]);

  // "Cobrar ahora" opens the collection form of that account.
  await clickUntil(
    confirmed.getByRole("button", { name: "Cobrar ahora" }),
    () =>
      expect(ana.getByLabel("Medio de pago")).toBeVisible({ timeout: 2_000 })
  );
  const card = account(ana, "5");
  await expect(card).toContainText("Pendiente $ 165,00");
  await ana.getByLabel("Medio de pago").selectOption("debit_card");
  await ana.getByLabel("Propina (opcional)").fill("5");
  const collect = ana.getByRole("button", { name: /^Registrar cobro de/u });
  await expect(collect).toContainText("$ 170,00");
  await collect.click();
  await expect(card).toContainText("Cuenta saldada", { timeout: 15_000 });
  await expect(card).toContainText("Propinas");
  await card.getByText(/^Movimientos/u).click();
  await expect(card).toContainText(
    "Cobro · Cobro presencial · Tarjeta de débito"
  );
  await expect(card).toContainText("Propina");
  expect((await business.entries()).map((entry) => entry.kind)).toEqual([
    "charge",
    "charge",
    "tip",
    "payment"
  ]);
  const [payment] = (await business.entries()).slice(-1);
  expect(payment?.amount).toBe(-17_000);

  // The salon shows the table occupied with its account.
  await ana.goto(`${base}/salon`);
  const unit = ana.locator(".waiter-unit", { hasText: "Mesa 5" });
  await expect(unit).toContainText("Ocupada");
  await expect(unit).toContainText("Cuenta abierta");
});

test("a partial payment and a manager discount move the balance, and keeping it open is its own decision", async ({
  browser
}) => {
  await business.placeOrder("6", ["milanesa", "pollo"]);
  const ana = await signIn(browser, "ana");
  await openAccounts(ana);
  const card = account(ana, "6");
  await expect(card).toContainText("Pendiente $ 215,00");

  // Leaving the account open records the decision and moves no money.
  const before = (await business.entries()).length;
  await clickUntil(
    card.getByRole("button", { name: /^Dejar cuenta abierta/u }),
    () =>
      expect(card.getByText("Cuenta abierta", { exact: true })).toBeVisible({
        timeout: 2_000
      })
  );
  expect((await business.entries()).length).toBe(before);

  // A partial payment lowers the pending balance by exactly that amount.
  await clickUntil(card.getByRole("button", { name: /^Cobrar ahora/u }), () =>
    expect(
      card.getByLabel("Monto a cobrar (vacío: todo el saldo)")
    ).toBeVisible({ timeout: 2_000 })
  );
  await card.getByLabel("Monto a cobrar (vacío: todo el saldo)").fill("50");
  await card.getByRole("button", { name: /^Registrar cobro de/u }).click();
  await expect(card).toContainText("Pendiente $ 165,00", { timeout: 15_000 });

  // A waiter cannot grant a discount; the manager can, always with a reason.
  await expect(
    card.getByRole("button", { name: /^Aplicar descuento/u })
  ).toHaveCount(0);
  const marta = await signIn(browser, "marta");
  await openAccounts(marta);
  const managed = account(marta, "6");
  await clickUntil(
    managed.getByRole("button", { name: /^Aplicar descuento/u }),
    () =>
      expect(managed.getByLabel("Porcentaje")).toBeVisible({ timeout: 2_000 })
  );
  const apply = managed.getByRole("button", {
    name: "Aplicar descuento",
    exact: true
  });
  await expect(apply).toBeDisabled();
  await managed.getByLabel("Porcentaje").fill("10");
  await managed
    .getByLabel("Motivo del descuento (obligatorio)")
    .fill("Cliente frecuente");
  await expect(apply).toBeEnabled();
  await apply.click();
  await expect(managed).toContainText("Pendiente $ 148,50", {
    timeout: 15_000
  });
  await expect(managed).toContainText("Descuentos");
  const kinds = (await business.entries()).map((entry) => entry.kind);
  expect(kinds.slice(-2)).toEqual(["payment", "discount"]);
});

test("the accounts screen fits the screen and every control has an accessible name", async ({
  browser
}) => {
  const marta = await signIn(browser, "marta");
  await openAccounts(marta);
  await expect(marta.getByRole("article").first()).toBeVisible();
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
