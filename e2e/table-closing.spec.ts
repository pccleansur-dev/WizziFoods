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
import { contextOptions, webPort } from "./stack-env";

const origin = `http://${adjustmentsHostname}:${webPort}`;
const base = `${origin}/interno/${adjustmentsSlug}/operacion`;

let business: AdjustmentsBusiness;
const contexts: BrowserContext[] = [];

test.describe.configure({ mode: "serial", timeout: 180_000 });

test.beforeAll(async () => {
  // The register starts closed, like the demo: Marta has to open it.
  business = await seedAdjustmentsBusiness({ openRegister: false });
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

async function openAccounts(page: Page) {
  await page.goto(`${base}/salon?vista=cuentas`);
  await expect(
    page.getByRole("heading", { name: "Cuentas de mesa" })
  ).toBeVisible();
}

function account(page: Page, table: string) {
  return page.getByRole("article", { name: `Mesa ${table}` });
}

async function noOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

/** Collects the whole balance of a table in cash, as its waiter. */
async function collectAll(page: Page, table: string) {
  const card = account(page, table);
  const open = card.getByRole("button", { name: /^Cobrar ahora/u });
  await hydrated(open);
  await clickUntil(open, () =>
    expect(card.getByLabel("Medio de pago")).toBeVisible({ timeout: 2_000 })
  );
  await card.getByRole("button", { name: /^Registrar cobro de/u }).click();
  await expect(card).toContainText("Cuenta saldada", { timeout: 15_000 });
}

test("pays, closes, keeps the QR blocked until the table is cleaned and then opens a new account", async ({
  browser
}) => {
  await business.placeOrder("5", ["milanesa", "cerveza"]);

  // Nobody collects before the manager opens the register.
  const marta = await signIn(browser, "marta");
  await marta.goto(`${base}/salon?vista=caja`);
  await expect(
    marta.getByRole("heading", { name: "Caja", exact: true })
  ).toBeVisible();
  await hydrated(marta.getByLabel("Efectivo inicial en el cajón (fondo)"));
  await marta.getByLabel("Efectivo inicial en el cajón (fondo)").fill("50");
  await clickUntil(
    marta.getByRole("button", { name: "Abrir caja", exact: true }),
    () => expect(marta.getByTestId("cash-open")).toBeVisible({ timeout: 2_000 })
  );

  const ana = await signIn(browser, "ana");
  await openAccounts(ana);
  const card = account(ana, "5");
  await expect(card).toContainText("Pendiente $ 165,00");
  // A balance blocks the close: the button is simply not there.
  await expect(
    card.getByRole("button", { name: /^Cerrar cuenta/u })
  ).toHaveCount(0);

  // While the account is open the diner at the table can still order.
  const phone = await browser.newContext(
    contextOptions(test.info().project.use)
  );
  contexts.push(phone);
  const diner = await phone.newPage();
  const token = await business.dinerToken("5");
  await diner.goto(`${origin}/m/${token}`);
  await expect(
    diner.locator(".diner-abilities").getByText("Hacer el pedido")
  ).toBeVisible();

  await collectAll(ana, "5");
  const close = card.getByRole("button", { name: /^Cerrar cuenta/u });
  await expect(close).toBeVisible();
  await clickUntil(close, () =>
    expect(
      ana.getByText(
        "Cuenta cerrada. La mesa 5 quedó pendiente de limpieza. Comprobante N° 1."
      )
    ).toBeVisible({ timeout: 2_000 })
  );
  await expect(card).toHaveCount(0, { timeout: 15_000 });

  // Paid is not free: the QR of that table now only shows the menu.
  await diner.reload();
  await expect(diner.getByText("El pedido lo toma el mozo")).toBeVisible();
  await expect(
    diner.locator(".diner-abilities").getByText("Hacer el pedido")
  ).toHaveCount(0);

  // The salon shows it waiting for cleaning, and only now can it be enabled.
  await ana.goto(`${base}/salon`);
  const unit = ana.locator(".waiter-unit", { hasText: "Mesa 5" });
  await expect(unit).toContainText("Pendiente de limpieza");
  await noOverflow(ana);
  const clean = unit.getByRole("button", {
    name: "Marcar limpia y habilitar: Mesa 5"
  });
  await hydrated(clean);
  await clickUntil(clean, () =>
    expect(unit).toContainText("Disponible", { timeout: 2_000 })
  );
  await expect(unit).toContainText("Sin cuenta abierta");

  // The QR works again and the next order opens a brand new account.
  await diner.reload();
  await expect(
    diner.locator(".diner-abilities").getByText("Hacer el pedido")
  ).toBeVisible();
  await business.placeOrder("5", ["cerveza"]);
  await openAccounts(ana);
  await expect(account(ana, "5")).toContainText("Pendiente $ 40,00", {
    timeout: 15_000
  });
});

test("the receipt says it is not an invoice and 'Avisar a caja' creates one internal request", async ({
  browser
}) => {
  await business.placeOrder("6", ["milanesa", "pollo"]);
  const ana = await signIn(browser, "ana");
  await openAccounts(ana);
  await collectAll(ana, "6");
  const close = account(ana, "6").getByRole("button", {
    name: /^Cerrar cuenta/u
  });
  await clickUntil(close, () =>
    expect(ana.getByText(/Comprobante N° 2\.$/u)).toBeVisible({
      timeout: 2_000
    })
  );

  const closed = ana.getByRole("region", { name: "Cuentas cerradas" });
  await expect(closed).toContainText("Mesa 6 · Comprobante N° 2");
  await noOverflow(ana);

  // The receipt keeps the figures of the close and the non-fiscal wording.
  const href = await closed
    .getByRole("link", { name: /^Ver comprobante/u })
    .first()
    .getAttribute("href");
  await ana.goto(`${origin}${href}`);
  await expect(
    ana.getByRole("heading", {
      name: "Comprobante de consumo — no válido como factura"
    })
  ).toBeVisible();
  await expect(
    ana.getByText(
      "¿Necesitás factura? Por el momento, la facturación se realiza en caja"
    )
  ).toBeVisible();
  await expect(ana.getByRole("list", { name: "Consumos" })).toContainText(
    "Milanesa"
  );
  await expect(ana.getByRole("list", { name: "Consumos" })).toContainText(
    "Pollo"
  );
  await expect(ana.getByLabel("Importes")).toContainText("$ 215,00");
  await expect(ana.getByLabel("Importes")).toContainText("Cobrado · Efectivo");
  await expect(ana.getByLabel(/cuit|razón social|domicilio/iu)).toHaveCount(0);
  await noOverflow(ana);

  // "Avisar a caja" is internal: one request, no fiscal data asked anywhere.
  await openAccounts(ana);
  const panel = ana.getByRole("region", { name: "Cuentas cerradas" });
  const notify = panel.getByRole("button", {
    name: "Avisar a caja: Mesa 6 · Comprobante N° 2"
  });
  await hydrated(notify);
  await clickUntil(notify, () =>
    expect(panel).toContainText("Caja avisada", { timeout: 2_000 })
  );
  await expect(notify).toBeDisabled();
  await expect(ana.getByLabel(/cuit|razón social|domicilio/iu)).toHaveCount(0);

  // The manager marks it as attended; the waiter then sees it resolved.
  const marta = await signIn(browser, "marta");
  await openAccounts(marta);
  const managed = marta.getByRole("region", { name: "Cuentas cerradas" });
  const done = managed.getByRole("button", {
    name: /^Marcar atendido el aviso a caja/u
  });
  await hydrated(done);
  await clickUntil(done, () =>
    expect(managed).toContainText("Caja atendió el aviso", { timeout: 2_000 })
  );
  await expect(
    ana.getByRole("button", { name: /^Marcar atendido/u })
  ).toHaveCount(0);

  // A waiter outside the sector or a cook never reaches the receipt.
  const coco = await signIn(browser, "coco");
  await coco.goto(`${origin}${href}`);
  await expect(coco).not.toHaveURL(/comprobante/u);
});
