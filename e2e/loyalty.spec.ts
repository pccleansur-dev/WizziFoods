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
import { seedLoyaltyBusiness, type LoyaltyBusiness } from "./loyalty-data";
import { contextOptions, webPort } from "./stack-env";

const origin = `http://${adjustmentsHostname}:${webPort}`;
const base = `${origin}/interno/${adjustmentsSlug}/operacion`;

let business: LoyaltyBusiness;
const contexts: BrowserContext[] = [];

test.describe.configure({ mode: "serial", timeout: 240_000 });

test.beforeAll(async () => {
  business = await seedLoyaltyBusiness();
});

test.afterAll(async () => {
  for (const context of contexts.splice(0)) await context.close();
  await business?.close();
});

async function newPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    ...contextOptions(test.info().project.use),
    baseURL: origin
  });
  contexts.push(context);
  return context.newPage();
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

/** A click that lands before React hydrates is lost; every action here is idempotent. */
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

async function signInStaff(browser: Browser, username: string) {
  const page = await newPage(browser);
  await page.goto(`${origin}/interno/${adjustmentsSlug}`);
  await page.getByLabel("Usuario").fill(username);
  await page.getByLabel("PIN de 6 dígitos").fill(adjustmentsPin);
  await page.getByRole("button", { name: "Entrar a la operación" }).click();
  await expect(page).toHaveURL(/\/operacion$/u);
  return page;
}

test("completes the goal and uses the reward in the same purchase", async ({
  browser
}) => {
  const diner = await newPage(browser);
  const token = await business.dinerToken("5");

  // 1. Ana signs in with the (simulated) Google and creates her profile.
  await diner.goto(`/m/${token}`);
  await expect(diner.getByText("Hacer el pedido", { exact: true })).toBeVisible();
  await diner
    .getByRole("button", { name: /Ingresar con Google/u })
    .first()
    .click();
  await diner.getByLabel("Correo").fill("fake:ana@loyalty.example");
  await diner.getByRole("button", { name: "Continuar" }).click();
  await diner.getByLabel("Tu nombre en este local").fill("Ana");
  await diner.getByRole("button", { name: "Crear mi perfil" }).click();
  await expect(diner.getByText("Hola, Ana")).toBeVisible();

  // 2. A finished visit two days ago reaches the goal of the program: one reward.
  await business.completeVisit("Ana", { cents: 20_000, daysAgo: 2 });
  expect(await business.rewardStatuses("Ana")).toEqual(["available"]);

  // 3. Today she orders at table 5, joins the account and sees her reward.
  await business.placeOrder("5", ["milanesa", "cerveza"]);
  await diner.goto(`/m/${token}`);
  await expect(diner.getByText("Hola, Ana")).toBeVisible();
  await diner.getByRole("link", { name: "Mi cuenta" }).click();
  await expect(diner.getByRole("heading", { name: "Mis premios" })).toBeVisible();
  await expect(diner.getByText("10% de descuento")).toBeVisible();
  const use = diner.getByRole("button", { name: "Usar en mi cuenta" });
  await expect(use).toBeVisible({ timeout: 30_000 });
  await hydrated(use);
  await clickUntil(use, () =>
    expect(diner.getByText(/Reservamos el premio/u)).toBeVisible({
      timeout: 2_000
    })
  );
  expect(await business.rewardStatuses("Ana")).toEqual(["reserved"]);

  // 4. The waiter sees the reserved reward and charges the rest in one operation.
  const waiter = await signInStaff(browser, "ana");
  await waiter.goto(`${base}/salon?vista=cuentas`);
  const card = waiter.getByRole("article", { name: "Mesa 5" });
  const open = card.getByRole("button", { name: /^Cobrar ahora/u });
  await hydrated(open);
  await clickUntil(open, () =>
    expect(card.getByLabel("Medio de pago").first()).toBeVisible({
      timeout: 2_000
    })
  );
  const redeem = card.getByRole("button", {
    name: "Canjear premio de Ana y cobrar"
  });
  await expect(redeem).toBeVisible({ timeout: 30_000 });
  await redeem.click();
  await expect(card).toContainText("Cuenta saldada", { timeout: 20_000 });

  const entries = await business.entries();
  // Today's purchase only: the earlier visit consumed 200 pesos on table 6.
  const consumed =
    entries
      .filter((entry) => entry.kind === "charge")
      .reduce((sum, entry) => sum + entry.amount, 0) - 20_000;
  expect(await business.discounts()).toEqual([-Math.round(consumed / 10)]);
  expect(await business.rewardStatuses("Ana")).toEqual(["redeemed"]);

  // 5. Closing that very purchase is a new visit, and it earns the next reward.
  const close = card.getByRole("button", { name: /^Cerrar cuenta/u });
  await clickUntil(close, () =>
    expect(waiter.getByText(/^Cuenta cerrada\./u)).toBeVisible({
      timeout: 2_000
    })
  );
  await expect
    .poll(() => business.rewardStatuses("Ana"), { timeout: 20_000 })
    .toEqual(["redeemed", "available"]);
  expect(await business.visits("Ana")).toEqual(["credited", "credited"]);

  await diner.goto(`/cuenta?volver=/m/${token}`);
  await expect(diner.getByText("¡ya tenés un premio disponible!")).toBeVisible();
});

test("the menu never depends on the loyalty program", async ({ browser }) => {
  const guest = await newPage(browser);
  await guest.route("**/api/diner/loyalty**", (route) => route.abort());
  await guest.goto(`/m/${await business.dinerToken("6")}`);
  await expect(guest.getByText("Hacer el pedido", { exact: true })).toBeVisible();
});
