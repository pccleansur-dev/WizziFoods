import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page
} from "@playwright/test";

import { webPort } from "./stack-env";
import {
  seedWaiterBusiness,
  staffPin,
  waiterHostname,
  waiterSlug,
  type WaiterBusiness
} from "./waiter-data";

const origin = `http://${waiterHostname}:${webPort}`;
const salonUrl = `${origin}/interno/${waiterSlug}/operacion/salon`;

let business: WaiterBusiness;
const contexts: BrowserContext[] = [];

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  business = await seedWaiterBusiness();
});

test.afterEach(async () => {
  for (const context of contexts.splice(0)) await context.close();
});

test.afterAll(async () => {
  await business?.close();
});

/** A fresh browser profile signed in with a staff username and PIN. */
async function signIn(browser: Browser, username: string): Promise<Page> {
  const context = await browser.newContext({ ...test.info().project.use });
  contexts.push(context);
  const page = await context.newPage();
  await page.goto(`${origin}/interno/${waiterSlug}`);
  await page.getByLabel("Usuario").fill(username);
  await page.getByLabel("PIN de 6 dígitos").fill(staffPin);
  await page.getByRole("button", { name: "Entrar a la operación" }).click();
  await expect(page).toHaveURL(/\/operacion$/u);
  return page;
}

/** The diner scans the QR of a table and sends the order. */
async function dinerSends(
  browser: Browser,
  label: string,
  dinerName: string,
  method: "Efectivo" | "Mercado Pago" = "Efectivo"
) {
  const context = await browser.newContext({ ...test.info().project.use });
  contexts.push(context);
  const page = await context.newPage();
  await page.goto(`${origin}/m/${business.tokens.get(label)!}`);
  await page.getByRole("button", { name: "Ver detalle de Milanesa" }).click();
  await page.getByRole("button", { name: "Agregar a Mi pedido" }).click();
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByLabel("Tu nombre").fill(dinerName);
  if (method === "Mercado Pago") await page.getByLabel("Mercado Pago").check();
  await page.getByRole("button", { name: "Enviar pedido" }).click();
  await expect(
    page.getByRole("heading", {
      name: method === "Efectivo" ? "Ya avisamos al mozo" : "Pago pendiente"
    })
  ).toBeVisible();
}

function intentCard(page: Page, label: string, dinerName: string) {
  return page.getByRole("article", {
    name: `Mesa ${label} · ${dinerName}`
  });
}

test("client → call → waiter → confirmed order, without payment or production", async ({
  browser
}) => {
  const dinerName = `Cliente ${test.info().project.name}`;
  await dinerSends(browser, "1", dinerName);

  const ana = await signIn(browser, "ana");
  const bruno = await signIn(browser, "bruno");
  for (const page of [ana, bruno]) await page.goto(salonUrl);
  await expect(
    ana.getByRole("heading", { name: "Llamados y pedidos por validar" })
  ).toBeVisible();
  const anaCard = intentCard(ana, "1", dinerName);
  await expect(anaCard).toContainText("Milanesa");
  await expect(anaCard).toContainText("Efectivo");
  await expect(anaCard).toContainText("Cuenta general");
  await expect(anaCard).toContainText("Sin atender");

  await anaCard
    .getByRole("button", { name: "Tomar llamado de mesa 1" })
    .click();
  await expect(anaCard).toContainText("Lo estás atendiendo");

  // The second waiter still sees the old state and loses the race.
  await intentCard(bruno, "1", dinerName)
    .getByRole("button", { name: "Tomar llamado de mesa 1" })
    .click();
  await expect(bruno.locator(".waiter-notice--error")).toContainText(
    "Otro mozo ya tomó este llamado."
  );

  await anaCard
    .getByRole("button", { name: "Confirmar pedido de mesa 1" })
    .click();
  const confirmed = ana.getByRole("region", {
    name: "Pedido confirmado · Mesa 1"
  });
  await expect(confirmed).toBeVisible();
  await expect(confirmed).toContainText("no registrado");
  await expect(confirmed).toContainText("Total del pedido");
  for (const name of ["Cobrar ahora", "Dejar cuenta abierta"]) {
    await expect(confirmed.getByRole("button", { name })).toHaveAttribute(
      "aria-disabled",
      "true"
    );
  }

  expect(await business.intentStatus(dinerName)).toBe("confirmed");
  expect(await business.orderCounts()).toEqual({ confirmed: 1, manual: 0 });
  expect(await business.forbiddenArtifacts()).toEqual([]);
  expect(await business.tableStateRows()).toBe(0);
});

test("each waiter only sees the tables of their sectors", async ({
  browser
}) => {
  const bruno = await signIn(browser, "bruno");
  await bruno.goto(salonUrl);
  await expect(bruno.getByText("Mesa 1", { exact: true })).toBeVisible();
  await expect(bruno.getByText("Mesa 2", { exact: true })).toBeVisible();
  await expect(bruno.getByText("Mesa 3", { exact: true })).toHaveCount(0);

  const carla = await signIn(browser, "carla");
  await carla.goto(salonUrl);
  await expect(carla.getByText("Mesa 3", { exact: true })).toBeVisible();
  await expect(carla.getByText("Mesa 1", { exact: true })).toHaveCount(0);

  const marta = await signIn(browser, "marta");
  await marta.goto(salonUrl);
  for (const label of ["Mesa 1", "Mesa 2", "Mesa 3"]) {
    await expect(marta.getByText(label, { exact: true })).toBeVisible();
  }
});

test("rejecting requires a reason and closes the call", async ({ browser }) => {
  const dinerName = `Rechazo ${test.info().project.name}`;
  await dinerSends(browser, "2", dinerName);
  const ana = await signIn(browser, "ana");
  await ana.goto(salonUrl);
  const card = intentCard(ana, "2", dinerName);
  await card.getByRole("button", { name: "Rechazar…" }).click();
  const submit = card.getByRole("button", { name: "Rechazar pedido" });
  await expect(submit).toBeDisabled();
  await card.getByLabel("Motivo del rechazo (obligatorio)").fill("Se equivocó");
  await submit.click();
  await expect(
    ana.getByRole("status").filter({ hasText: "Pedido rechazado." })
  ).toBeVisible();
  await expect(card).toHaveCount(0);
  expect(await business.intentStatus(dinerName)).toBe("rejected");
});

test("a pending Mercado Pago payment never reaches the waiter", async ({
  browser
}) => {
  const dinerName = `Online ${test.info().project.name}`;
  await dinerSends(browser, "1", dinerName, "Mercado Pago");
  const marta = await signIn(browser, "marta");
  await marta.goto(salonUrl);
  await expect(marta.getByRole("heading", { name: "Mesas" })).toBeVisible();
  await expect(marta.getByText(dinerName)).toHaveCount(0);
  expect(await business.intentStatus(dinerName)).toBe("payment_pending");
});

test("a waiter loads a manual order for a table within their sectors", async ({
  browser
}) => {
  const ana = await signIn(browser, "ana");
  await ana.goto(`${salonUrl}?vista=comanda`);
  await expect(
    ana.getByRole("heading", { name: "Cargar comanda" })
  ).toBeVisible();
  const tables = ana.getByLabel("Mesa", { exact: true });
  await expect(tables.locator("option")).toHaveText(["Mesa 1", "Mesa 2"]);
  await ana.getByLabel("A una persona").check();
  const submit = ana.getByRole("button", { name: "Confirmar comanda" });
  await ana.getByRole("button", { name: "Agregar Milanesa" }).click();
  await expect(submit).toBeDisabled();
  await ana.getByLabel(/^Nombre/u).fill("Marcos");
  await ana.getByLabel(/^Silla/u).fill("Silla 2");
  await expect(submit).toBeEnabled();
  await submit.click();
  const confirmed = ana.getByRole("region", {
    name: "Pedido confirmado · Mesa 1"
  });
  await expect(confirmed).toBeVisible();
  await expect(confirmed).toContainText("no registrado");
  await expect(business.orderCounts()).resolves.toMatchObject({ manual: 1 });
});

test("kitchen staff cannot open the salon", async ({ browser }) => {
  const coco = await signIn(browser, "coco");
  await coco.goto(salonUrl);
  await expect(coco).toHaveURL(/\/operacion$/u);
  const response = await coco.request.get(
    `${salonUrl.replace("/salon", "")}/vista`
  );
  expect(response.status()).toBe(403);
});

test("the salon fits the screen and every control has an accessible name", async ({
  browser
}) => {
  const marta = await signIn(browser, "marta");
  await marta.goto(salonUrl);
  await expect(marta.getByRole("heading", { name: "Mesas" })).toBeVisible();
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
  const tiny = await marta.evaluate(() =>
    [...document.querySelectorAll("main *")]
      .filter(
        (element) =>
          element.children.length === 0 &&
          (element.textContent ?? "").trim().length > 0 &&
          parseFloat(getComputedStyle(element).fontSize) < 12
      )
      .map((element) => element.textContent?.slice(0, 40))
  );
  expect(tiny).toEqual([]);
});
