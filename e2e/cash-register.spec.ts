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

const origin = `http://${adjustmentsHostname}:${webPort}`;
const base = `${origin}/interno/${adjustmentsSlug}/operacion`;

let business: AdjustmentsBusiness;
const contexts: BrowserContext[] = [];

test.describe.configure({ mode: "serial", timeout: 180_000 });

test.beforeAll(async () => {
  // The register starts closed: opening it is part of the journey.
  business = await seedAdjustmentsBusiness({ openRegister: false });
});

test.afterEach(async () => {
  for (const context of contexts.splice(0)) await context.close();
});

test.afterAll(async () => {
  await business?.close();
});

async function signIn(browser: Browser, username: string): Promise<Page> {
  const context = await browser.newContext({ ...test.info().project.use });
  contexts.push(context);
  const page = await context.newPage();
  await page.goto(`${origin}/interno/${adjustmentsSlug}`);
  await page.getByLabel("Usuario").fill(username);
  await page.getByLabel("PIN de 6 dígitos").fill(adjustmentsPin);
  await page.getByRole("button", { name: "Entrar a la operación" }).click();
  await expect(page).toHaveURL(/\/operacion$/u);
  return page;
}

/** A click that lands before React hydrates is lost; every action is idempotent. */
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

/** The page also has an empty route announcer with role alert: pick ours by its text. */
function closedNotice(page: Page) {
  return page.getByRole("alert").filter({ hasText: "La caja está cerrada" });
}

function account(page: Page, table: string) {
  return page.getByRole("article", { name: `Mesa ${table}` });
}

test("opening the register, mixed collections, a refund and a blind close with a justified difference", async ({
  browser
}) => {
  const orderId = await business.placeOrder("5", ["cerveza", "milanesa"]);

  // Closed register: the waiter sees why she cannot collect, and has no Caja.
  const ana = await signIn(browser, "ana");
  await ana.goto(`${base}/salon?vista=cuentas`);
  await expect(
    ana.getByRole("heading", { name: "Cuentas de mesa" })
  ).toBeVisible();
  await expect(closedNotice(ana)).toContainText("La caja está cerrada");
  await expect(
    account(ana, "5").getByRole("button", { name: /^Cobrar ahora/u })
  ).toBeDisabled();
  await expect(ana.getByRole("button", { name: /^Caja/u })).toHaveCount(0);

  // The manager opens it with a float.
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
  await expect(marta.getByTestId("cash-open")).toContainText("$ 50,00");

  // Mixed collection: cash for part, a physical card for the rest.
  await ana.goto(`${base}/salon?vista=cuentas`);
  const card = account(ana, "5");
  await expect(card).toContainText("Pendiente $ 165,00");
  await hydrated(card.getByRole("button", { name: /^Cobrar ahora/u }));
  await clickUntil(card.getByRole("button", { name: /^Cobrar ahora/u }), () =>
    expect(
      card.getByLabel("Monto a cobrar (vacío: todo el saldo)")
    ).toBeVisible({ timeout: 2_000 })
  );
  await card.getByLabel("Monto a cobrar (vacío: todo el saldo)").fill("100");
  await card.getByRole("button", { name: /^Registrar cobro de/u }).click();
  await expect(card).toContainText("Pendiente $ 65,00", { timeout: 15_000 });

  await clickUntil(card.getByRole("button", { name: /^Cobrar ahora/u }), () =>
    expect(card.getByLabel("Medio de pago")).toBeVisible({ timeout: 2_000 })
  );
  await card.getByLabel("Medio de pago").selectOption("debit_card");
  // A physical card is only a payment method here: nothing asks for its data.
  await expect(
    card.getByLabel(/número|vencimiento|cvv|cvc|titular|\bpin\b/iu)
  ).toHaveCount(0);
  await card.getByRole("button", { name: /^Registrar cobro de/u }).click();
  await expect(card).toContainText("Cuenta saldada", { timeout: 15_000 });

  // The beer is cancelled after paying: the diner has a credit to get back.
  await business.cancelFirstItem(orderId);
  await marta.goto(`${base}/salon?vista=cuentas`);
  const managed = account(marta, "5");
  await expect(managed).toContainText("A favor del comensal $ 40,00");
  await hydrated(managed.getByRole("button", { name: /^Devolver/u }));
  await clickUntil(managed.getByRole("button", { name: /^Devolver/u }), () =>
    expect(managed.getByLabel("Pago a devolver")).toBeVisible({
      timeout: 2_000
    })
  );
  const submitRefund = managed.getByRole("button", {
    name: "Registrar devolución"
  });
  await expect(submitRefund).toBeDisabled();
  // Options: the placeholder, the cash payment and the card payment.
  await managed.getByLabel("Pago a devolver").selectOption({ index: 2 });
  await managed.getByLabel("Monto a devolver").fill("40");
  await managed
    .getByLabel("Motivo de la devolución (obligatorio)")
    .fill("Se terminó la cerveza");
  await expect(submitRefund).toBeEnabled();
  await submitRefund.click();
  await expect(managed).toContainText("Cuenta saldada", { timeout: 15_000 });
  expect((await business.entries()).map((entry) => entry.kind)).toContain(
    "refund"
  );

  // A cash withdrawal, then the blind close: 50 float + 100 cash - 20 = 130.
  await marta.goto(`${base}/salon?vista=caja`);
  await hydrated(marta.getByLabel("Monto", { exact: true }));
  await marta.getByLabel("Monto", { exact: true }).fill("20");
  await marta.getByLabel("Motivo (obligatorio)").fill("Retiro a caja fuerte");
  await clickUntil(
    marta.getByRole("button", { name: "Registrar movimiento" }),
    () =>
      expect(marta.getByTestId("cash-open")).toContainText(
        "Retiro de efectivo · Retiro a caja fuerte",
        { timeout: 2_000 }
      )
  );

  // Blind: the expected cash is nowhere on the screen while counting.
  await expect(marta.locator("body")).not.toContainText("130,00");
  await marta.getByLabel("Efectivo contado").fill("125");
  await clickUntil(marta.getByRole("button", { name: "Contar y cerrar" }), () =>
    expect(
      marta.getByRole("alert").filter({ hasText: "Faltan" })
    ).toContainText("Faltan $ 5,00", {
      timeout: 2_000
    })
  );
  const closeWithDifference = marta.getByRole("button", {
    name: "Cerrar con diferencia"
  });
  await expect(closeWithDifference).toBeDisabled();
  await marta
    .getByLabel("Justificá la diferencia (obligatorio)")
    .fill("Faltó cambio");
  await expect(closeWithDifference).toBeEnabled();
  await clickUntil(closeWithDifference, () =>
    expect(marta.getByRole("region", { name: "Caja cerrada" })).toBeVisible({
      timeout: 2_000
    })
  );
  const summary = marta.getByRole("region", { name: "Caja cerrada" });
  await expect(summary).toContainText("Faltan $ 5,00");
  await expect(summary).toContainText("Efectivo esperado");
  await expect(summary).toContainText("$ 130,00");
  await expect(summary).toContainText("Faltó cambio");
  expect(await business.closures()).toEqual([
    {
      counted: 12_500,
      difference: -500,
      expected: 13_000,
      reason: "Faltó cambio"
    }
  ]);

  // Closed again: collecting is refused for everyone until it is reopened.
  await expect(closedNotice(ana)).toBeVisible({ timeout: 15_000 });
  await ana.goto(`${base}/salon?vista=cuentas`);
  await expect(closedNotice(ana)).toContainText("La caja está cerrada");
});
