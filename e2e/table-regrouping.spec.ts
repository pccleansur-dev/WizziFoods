import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page
} from "@playwright/test";

import {
  regroupingHostname,
  regroupingPin,
  regroupingSlug,
  seedRegroupingBusiness,
  type RegroupingBusiness
} from "./regrouping-data";
import { contextOptions, webPort } from "./stack-env";

const origin = `http://${regroupingHostname}:${webPort}`;
const base = `${origin}/interno/${regroupingSlug}/operacion`;

let business: RegroupingBusiness;
const contexts: BrowserContext[] = [];

test.describe.configure({ mode: "serial", timeout: 240_000 });

test.beforeAll(async () => {
  business = await seedRegroupingBusiness();
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
  await page.goto(`${origin}/interno/${regroupingSlug}`);
  await page.getByLabel("Usuario").fill(username);
  await page.getByLabel("PIN de 6 dígitos").fill(regroupingPin);
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

async function hydrated(control: Locator) {
  await expect
    .poll(() =>
      control.evaluate((element) =>
        Object.keys(element).some((key) => key.startsWith("__reactProps"))
      )
    )
    .toBe(true);
}

async function noOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

async function openSalon(page: Page) {
  await page.goto(`${base}/salon`);
  await expect(page.getByRole("heading", { name: "Mesas" })).toBeVisible();
}

async function openAccounts(page: Page) {
  await page.goto(`${base}/salon?vista=cuentas`);
  await expect(
    page.getByRole("heading", { name: "Cuentas de mesa" })
  ).toBeVisible();
}

function unit(page: Page, label: string) {
  return page.locator(".waiter-unit", {
    has: page
      .getByRole("strong")
      .filter({ hasText: new RegExp(`^${label}$`, "u") })
  });
}

function account(page: Page, tables: string) {
  return page.getByRole("article", { name: `Mesa ${tables}` });
}

/** A diner scanning the QR of a table, on a phone of their own. */
async function diner(browser: Browser, table: "1" | "2" | "3" | "4") {
  const context = await browser.newContext(
    contextOptions(test.info().project.use)
  );
  contexts.push(context);
  const page = await context.newPage();
  await page.goto(`${origin}/m/${await business.dinerToken(table)}`);
  return page;
}

test("joins two tables, consumes, pays part, separates keeping the debt on one table and starts a new account on the other", async ({
  browser
}) => {
  // The register starts closed, like the demo: Marta opens it.
  const marta = await signIn(browser, "marta");
  await marta.goto(`${base}/salon?vista=caja`);
  await hydrated(marta.getByLabel("Efectivo inicial en el cajón (fondo)"));
  await marta.getByLabel("Efectivo inicial en el cajón (fondo)").fill("50");
  await clickUntil(
    marta.getByRole("button", { name: "Abrir caja", exact: true }),
    () => expect(marta.getByTestId("cash-open")).toBeVisible({ timeout: 2_000 })
  );

  // 1. Unir: two loose tables become one group with a name.
  const ana = await signIn(browser, "ana");
  await openSalon(ana);
  const pickOne = ana.getByLabel("Elegir para unir: Mesa 1");
  await hydrated(pickOne);
  await clickUntil(pickOne, () =>
    expect(pickOne).toBeChecked({ timeout: 2_000 })
  );
  await ana.getByLabel("Elegir para unir: Mesa 2").check();
  const joinPanel = ana.getByRole("region", { name: "Unir mesas" });
  await expect(joinPanel).toContainText("Mesas 1 + 2");
  await joinPanel.getByLabel("Nombre del grupo (opcional)").fill("Cumple");
  await noOverflow(ana);
  await joinPanel.getByRole("button", { name: "Unir mesas" }).click();
  await expect(
    ana.getByText(
      "Mesas 1 + 2 unidas. Se abre una sola cuenta con el primer pedido."
    )
  ).toBeVisible({ timeout: 15_000 });
  const group = unit(ana, "Mesas 1 \\+ 2");
  await expect(group).toContainText("Cumple");
  await expect(group).toContainText("Una sola cuenta");

  // Every QR recognises the group, with no change to the QR codes themselves.
  const phoneTwo = await diner(browser, "2");
  await expect(
    phoneTwo.getByText("Estás en Cumple (mesas 1 y 2)")
  ).toBeVisible();
  const phoneOne = await diner(browser, "1");
  await expect(
    phoneOne.getByText("Estás en Cumple (mesas 1 y 2)")
  ).toBeVisible();

  // 2. Consumir: an order on table 1 opens ONE account for both tables.
  await business.placeOrder("1", ["milanesa", "cerveza"]);
  await openAccounts(ana);
  const card = account(ana, "1 + 2");
  await expect(card).toContainText("Pendiente $ 165,00");

  // 3. Pagar parcial: $ 50 now, the rest stays pending.
  await clickUntil(card.getByRole("button", { name: /^Cobrar ahora/u }), () =>
    expect(
      card.getByLabel("Monto a cobrar (vacío: todo el saldo)")
    ).toBeVisible({ timeout: 2_000 })
  );
  await card.getByLabel("Monto a cobrar (vacío: todo el saldo)").fill("50");
  await card.getByRole("button", { name: /^Registrar cobro de/u }).click();
  await expect(card).toContainText("Pendiente $ 115,00", { timeout: 15_000 });

  // A different open account is refused: table 3 has its own order.
  await business.placeOrder("3", ["cerveza"]);
  await openSalon(ana);
  const pickThree = ana.getByLabel("Elegir para unir: Mesa 3");
  await hydrated(pickThree);
  await clickUntil(ana.getByLabel("Elegir para unir: Mesas 1 + 2"), () =>
    expect(ana.getByLabel("Elegir para unir: Mesas 1 + 2")).toBeChecked({
      timeout: 2_000
    })
  );
  await expect(pickThree).toBeDisabled();
  await expect(unit(ana, "Mesa 3")).toContainText("cuenta abierta distinta");
  await ana.getByRole("button", { name: "Cancelar" }).first().click();

  const before = await business.fingerprint();

  // 4. Separar: the open account needs an anchor table.
  const separate = ana.getByRole("button", {
    name: "Separar mesas: Mesas 1 + 2"
  });
  await hydrated(separate);
  await clickUntil(separate, () =>
    expect(
      ana.getByRole("region", { name: "Separar Mesas 1 + 2" })
    ).toBeVisible({
      timeout: 2_000
    })
  );
  const separatePanel = ana.getByRole("region", {
    name: "Separar Mesas 1 + 2"
  });
  const confirm = separatePanel.getByRole("button", {
    name: "Separar mesas",
    exact: true
  });
  await expect(confirm).toBeDisabled();
  await separatePanel.getByLabel("Mesa 2").check();
  await expect(separatePanel).toContainText(
    "La cuenta abierta queda en la mesa 2"
  );
  await noOverflow(ana);
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(
    ana.getByText(
      "Separaste Mesas 1 + 2. La cuenta abierta quedó en la mesa 2; los pedidos, los pagos y el saldo no se movieron."
    )
  ).toBeVisible({ timeout: 15_000 });

  // Orders, payments and debt did not move.
  expect(await business.fingerprint()).toBe(before);
  expect(await business.groupEvents()).toBe(2);
  await expect(unit(ana, "Mesa 1")).toContainText("Disponible");
  await expect(unit(ana, "Mesa 1")).toContainText("Sin cuenta abierta");
  await expect(unit(ana, "Mesa 2")).toContainText("Ocupada");
  await expect(unit(ana, "Mesa 2")).toContainText("Saldo $ 115,00");

  await openAccounts(ana);
  await expect(account(ana, "2")).toContainText("Pendiente $ 115,00");
  await expect(account(ana, "1")).toHaveCount(0);

  // The QR codes follow: no more group, table 1 is free for a new party.
  await phoneOne.reload();
  await expect(phoneOne.getByText(/^Estás en /u)).toHaveCount(0);
  await expect(
    phoneOne.locator(".diner-abilities").getByText("Hacer el pedido")
  ).toBeVisible();
  await phoneTwo.reload();
  await expect(phoneTwo.getByText(/^Estás en /u)).toHaveCount(0);

  // 5. Nueva sesión: table 1 opens its own account, apart from the debt of table 2.
  await business.placeOrder("1", ["cerveza"]);
  await openAccounts(ana);
  await expect(account(ana, "1")).toContainText("Pendiente $ 40,00", {
    timeout: 15_000
  });
  await expect(account(ana, "2")).toContainText("Pendiente $ 115,00");

  // The old account is still settled on its own and closes by itself.
  const old = account(ana, "2");
  await clickUntil(old.getByRole("button", { name: /^Cobrar ahora/u }), () =>
    expect(old.getByLabel("Medio de pago")).toBeVisible({ timeout: 2_000 })
  );
  await old.getByRole("button", { name: /^Registrar cobro de/u }).click();
  await expect(old).toContainText("Cuenta saldada", { timeout: 15_000 });
  await noOverflow(ana);
});
