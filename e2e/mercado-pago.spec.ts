import { expect, test, type Page } from "@playwright/test";

import {
  adjustmentsHostname,
  adjustmentsPin,
  adjustmentsSlug,
  seedAdjustmentsBusiness,
  type AdjustmentsBusiness
} from "./adjustments-data";
import { webPort } from "./stack-env";

const origin = `http://${adjustmentsHostname}:${webPort}`;
let business: AdjustmentsBusiness;

test.describe.configure({ mode: "serial", timeout: 180_000 });

test.beforeAll(async () => {
  business = await seedAdjustmentsBusiness();
});

test.afterAll(async () => {
  await business?.close();
});

async function checkout(page: Page, name: string) {
  await page.goto(`${origin}/m/${business.token}`);
  await page.getByRole("button", { name: "Ver detalle de Milanesa" }).click();
  await page.getByRole("button", { name: "Agregar a Mi pedido" }).click();
  await page.getByRole("button", { name: /^Mi pedido/u }).click();
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page.getByLabel("Tu nombre").fill(name);
  await page.getByLabel("Mercado Pago").check();
  await page.getByRole("button", { name: "Enviar pedido" }).click();
  await expect(
    page.getByRole("heading", { name: "Pagá para confirmar el pedido" })
  ).toBeVisible();
}

async function managerLogin(page: Page) {
  await page.goto(`${origin}/interno/${adjustmentsSlug}`);
  await page.getByLabel("Usuario").fill("marta");
  await page.getByLabel("PIN de 6 dígitos").fill(adjustmentsPin);
  await page.getByRole("button", { name: "Entrar a la operación" }).click();
  await expect(page).toHaveURL(/\/operacion$/u);
}

test("sandbox covers accredited, pending, rejected and partial refund", async ({
  page
}) => {
  await checkout(page, `Acreditado ${test.info().project.name}`);
  await page.getByRole("button", { name: "Simular pago" }).click();
  await expect(
    page.getByRole("heading", { name: "Pago acreditado" })
  ).toBeVisible();

  const paid = await business.latestOnlinePayment();
  await business.cancelFirstItem(paid.orderId);

  await checkout(page, `Pendiente ${test.info().project.name}`);
  await page.getByLabel("Resultado de prueba").selectOption("pending");
  await page.getByRole("button", { name: "Simular pago" }).click();
  await expect(
    page.getByRole("heading", { name: "Todavía no se acreditó" })
  ).toBeVisible();

  await checkout(page, `Rechazado ${test.info().project.name}`);
  await page.getByLabel("Resultado de prueba").selectOption("rejected");
  await page.getByRole("button", { name: "Simular pago" }).click();
  await expect(
    page.getByRole("heading", { name: "Pago rechazado" })
  ).toBeVisible();

  await managerLogin(page);
  await page.goto(
    `${origin}/interno/${adjustmentsSlug}/operacion/salon?vista=cuentas`
  );
  const account = page.getByRole("article", { name: "Mesa 5" });
  await account
    .getByRole("button", { name: "Devolver por Mercado Pago: mesa 5" })
    .click();
  await account.getByLabel("Pago de Mercado Pago a devolver").selectOption({
    index: 1
  });
  await account.getByLabel("Monto a devolver por Mercado Pago").fill("40");
  await account
    .getByLabel("Motivo de la devolución online (obligatorio)")
    .fill("Devolución parcial E2E");
  await account
    .getByRole("button", { name: "Devolver por Mercado Pago", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({
      hasText: "Devolución confirmada por Mercado Pago"
    })
  ).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(async () => (await business.latestOnlinePayment()).refundedCents)
    .toBe(4_000);
});

test("a diner pays the share they reserved with Mercado Pago", async ({
  page
}) => {
  await business.placeOrder("6", ["milanesa", "cerveza"]);
  await managerLogin(page);
  await page.goto(
    `${origin}/interno/${adjustmentsSlug}/operacion/salon?vista=cuentas`
  );
  const account = page.getByRole("article", { name: "Mesa 6" });
  await expect(account).toContainText("Pendiente $ 165,00");
  const open = account.getByRole("button", { name: /^Dividir la cuenta/u });
  await expect(async () => {
    if (
      !(await account.getByLabel("Partes iguales del saldo pendiente").count())
    ) {
      await open.click({ timeout: 2_000 }).catch(() => undefined);
    }
    await expect(
      account.getByLabel("Partes iguales del saldo pendiente")
    ).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
  await account.getByLabel("Partes iguales del saldo pendiente").fill("2");
  await account.getByRole("button", { name: "Dividir", exact: true }).click();
  await expect(
    account.getByRole("list", { name: "Partes de la cuenta" })
  ).toContainText("$ 82,50");

  await page.goto(`${origin}/m/${await business.dinerToken("6")}`);
  await expect(async () => {
    await page
      .getByRole("button", { name: "Dividir la cuenta" })
      .click({ timeout: 2_000 })
      .catch(() => undefined);
    await expect(
      page.getByRole("heading", { name: "Tu parte de la cuenta" })
    ).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
  await page.getByLabel("Tu nombre").fill("Ana");
  await page.getByRole("button", { name: "Tomar la parte 1" }).click();
  await page
    .getByRole("button", { name: "Pagar la parte 1 con Mercado Pago" })
    .click();
  await page.getByRole("button", { name: "Simular pago" }).click();
  await expect(page.getByRole("heading", { name: "Parte pagada" })).toBeVisible(
    { timeout: 20_000 }
  );
  await expect(page.getByLabel(/número|vencimiento|cvv|cvc/iu)).toHaveCount(0);
  const payments = (await business.entries()).filter(
    (entry) => entry.kind === "payment"
  );
  expect(payments.at(-1)?.amount).toBe(-8_250);
});
