import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page
} from "@playwright/test";

import { apiPort, webPort } from "./stack-env";
import { contextOptions } from "./stack-env";
import {
  catalogProduct,
  seedWaiterBusiness,
  staffPin,
  waiterHostname,
  waiterSlug,
  type WaiterBusiness
} from "./waiter-data";

const origin = `http://${waiterHostname}:${webPort}`;
const salonUrl = `${origin}/interno/${waiterSlug}/operacion/salon`;
const catalogUrl = `${origin}/interno/${waiterSlug}/operacion/carta`;

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
  const context = await browser.newContext(
    contextOptions(test.info().project.use)
  );
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
  const context = await browser.newContext(
    contextOptions(test.info().project.use)
  );
  contexts.push(context);
  const page = await context.newPage();
  await page.goto(`${origin}/m/${business.tokens.get(label)!}`);
  await page.getByRole("button", { name: "Ver detalle de Milanesa" }).click();
  await page.getByRole("button", { name: "Agregar a Mi pedido" }).click();
  await page.getByRole("button", { name: /^Mi pedido/u }).click();
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page.getByLabel("Tu nombre").fill(dinerName);
  if (method === "Mercado Pago") await page.getByLabel("Mercado Pago").check();
  await page.getByRole("button", { name: "Enviar pedido" }).click();
  if (method === "Mercado Pago") {
    await expect(
      page.getByRole("heading", { name: "Pagá para confirmar el pedido" })
    ).toBeVisible();
    await page.getByLabel("Resultado de prueba").selectOption("pending");
    await page.getByRole("button", { name: "Simular pago" }).click();
    await expect(
      page.getByRole("heading", { name: "Todavía no se acreditó" })
    ).toBeVisible();
    return;
  }
  await expect(
    page.getByRole("heading", { name: "Ya avisamos al mozo" })
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

  // Realtime would tell the second waiter at once; to play the race, their screen cannot
  // reach the server for a moment, as on a flaky connection.
  await bruno.route("**/operacion/vista", (route) => route.abort());
  await anaCard
    .getByRole("button", { name: "Tomar llamado de mesa 1" })
    .click();
  await expect(anaCard).toContainText("Lo estás atendiendo");

  // The second waiter still sees the old state and loses the race.
  await intentCard(bruno, "1", dinerName)
    .getByRole("button", { name: "Tomar llamado de mesa 1" })
    .click();
  await expect(
    bruno.getByRole("alert").filter({ hasText: "Otro mozo" })
  ).toContainText("Otro mozo ya tomó este llamado.");
  await bruno.unroute("**/operacion/vista");

  await anaCard
    .getByRole("button", { name: "Confirmar pedido de mesa 1" })
    .click();
  const confirmed = ana.getByRole("region", {
    name: "Pedido confirmado · Mesa 1"
  });
  await expect(confirmed).toBeVisible();
  await expect(confirmed).toContainText("no registrado");
  await expect(confirmed).toContainText("Total del pedido");
  // T22: both account decisions are available, separate from confirming.
  for (const name of ["Cobrar ahora", "Dejar cuenta abierta"]) {
    await expect(confirmed.getByRole("button", { name })).toBeEnabled();
  }
  await expect(confirmed).toContainText("Enviado a producción");

  expect(await business.intentStatus(dinerName)).toBe("confirmed");
  expect(await business.orderCounts()).toEqual({ confirmed: 1, manual: 0 });
  expect(await business.forbiddenArtifacts()).toEqual([]);
  expect(await business.tableStateRows()).toBe(1);
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
  await expect(
    ana.getByRole("button", { name: "Agregar Milanesa" })
  ).toHaveCount(0);
  await ana.getByLabel("Buscar producto").fill("milanesa");
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

test("a manager changes availability for the diner and the waiter without overwriting a newer change", async ({
  browser
}) => {
  const manager = await signIn(browser, "marta");
  const otherManager = await signIn(browser, "marta");
  const waiter = await signIn(browser, "ana");
  await Promise.all([manager.goto(catalogUrl), otherManager.goto(catalogUrl)]);

  const markSoldOut = (page: Page) =>
    page.getByRole("button", { name: "Marcar agotado: Milanesa" });
  await expect(markSoldOut(otherManager)).toBeVisible();
  await markSoldOut(manager).click();
  await expect(manager.getByText("Agotado", { exact: true })).toBeVisible();
  await markSoldOut(otherManager).click();
  await expect(
    otherManager.getByRole("alert").filter({ hasText: "La carta cambió" })
  ).toBeVisible();
  await expect(
    otherManager.getByText("Agotado", { exact: true })
  ).toBeVisible();

  const phone = await browser.newContext(
    contextOptions(test.info().project.use)
  );
  contexts.push(phone);
  const diner = await phone.newPage();
  const qr = `${origin}/m/${business.tokens.get("2")!}`;
  await diner.goto(qr);
  await expect(diner.getByText("No disponible", { exact: true })).toBeVisible();

  await waiter.goto(`${salonUrl}?vista=comanda`);
  await expect(
    waiter.getByRole("heading", { name: "Cargar comanda" })
  ).toBeVisible();
  await waiter.getByLabel("Buscar producto").fill("milanesa");
  const addMilanesa = waiter.getByRole("button", { name: "Agregar Milanesa" });
  await expect(addMilanesa).toHaveCount(0);
  const session = (await waiter.context().cookies(salonUrl)).find(
    ({ name }) => name === `staff_session_${waiterSlug}`
  );
  expect(session).toBeDefined();
  const forbidden = await waiter.request.post(
    `http://localhost:${apiPort}/v1/staff/menu/products/${catalogProduct}/availability`,
    {
      data: { expectedVersion: 1, isAvailable: true },
      headers: { authorization: `Bearer ${session!.value}` }
    }
  );
  expect(forbidden.status()).toBe(403);

  await manager
    .getByRole("button", { name: "Volver a ofrecer: Milanesa" })
    .click();
  await expect(markSoldOut(manager)).toBeVisible();
  await diner.reload();
  await expect(
    diner.getByRole("button", { name: "Ver detalle de Milanesa" })
  ).toBeEnabled();
  await waiter.reload();
  await expect(addMilanesa).toBeVisible();
});

test("a manager edits the floor plan and downloads the same table QR", async ({
  browser
}) => {
  test.setTimeout(60_000);
  const manager = await signIn(browser, "marta");
  await manager.goto(salonUrl);
  await manager.getByRole("link", { name: "Plano y QR" }).click();
  const editor = manager.getByRole("region", { name: "Plano del salón" });
  const qrView = editor.getByRole("button", { name: /^Códigos QR/u });
  const qr = editor.getByRole("img", { name: "Código QR de la mesa 1" });
  const openQr = async () => {
    await expect(async () => {
      if (!(await qr.isVisible())) await qrView.click({ timeout: 2_000 });
      await expect(qr).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
  };
  await openQr();
  const originalQr = await qr.getAttribute("src");
  expect(originalQr).toMatch(/^data:image\/svg\+xml/u);

  await editor.getByRole("button", { name: "Plano", exact: true }).click();
  await editor.getByRole("button", { name: /^Mesa 1,/u }).click();
  await editor.getByLabel("Posición X").fill("55");
  await editor.getByLabel("Sillas", { exact: true }).fill("5");
  await editor.getByRole("button", { name: "Guardar plano" }).click();
  await expect(editor.getByText(/Plano guardado/u)).toBeVisible();
  await expect(
    editor.getByRole("button", { name: /^Mesa 1, 5 sillas/u })
  ).toBeVisible();

  await manager.reload();
  await expect(async () => {
    if (!(await editor.getByLabel("Posición X").isVisible())) {
      await editor.getByRole("button", { name: /^Mesa 1, 5 sillas/u }).click();
    }
    await expect(editor.getByLabel("Posición X")).toHaveValue("55", {
      timeout: 1_000
    });
  }).toPass({ timeout: 15_000 });
  await openQr();
  await expect(qr).toHaveAttribute("src", originalQr!);
  const downloadButton = qr
    .locator("..")
    .getByRole("button", { name: "Descargar QR" });
  await downloadButton.evaluate((element) =>
    element.scrollIntoView({ block: "center", inline: "center" })
  );
  const [download] = await Promise.all([
    manager.waitForEvent("download", { timeout: 8_000 }),
    downloadButton.press("Enter")
  ]);
  expect(download.suggestedFilename()).toBe("qr-mesa-1.svg");

  const waiter = await signIn(browser, "ana");
  await waiter.goto(salonUrl);
  await expect(waiter.getByRole("link", { name: "Plano y QR" })).toHaveCount(0);
  await waiter.goto(new URL(manager.url()).href);
  await expect(waiter).toHaveURL(/\/operacion$/u);
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
