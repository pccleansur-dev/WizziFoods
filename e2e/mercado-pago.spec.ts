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
  await page.getByRole("button", { name: "Continuar" }).click();
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
  ).toBeVisible();
  await expect
    .poll(async () => (await business.latestOnlinePayment()).refundedCents)
    .toBe(4_000);
});
