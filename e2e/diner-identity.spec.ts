import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import {
  seedDinerBusiness,
  tables,
  type DinerBusiness
} from "./diner-identity-data";
import { contextOptions, e2eHostname, webPort } from "./stack-env";

const origin = `http://${e2eHostname}:${webPort}`;

let business: DinerBusiness;
let context: BrowserContext;
// One browser profile for the whole journey: the diner keeps their cookies.
let page: Page;

test.describe.configure({ mode: "serial", timeout: 180_000 });

test.beforeAll(async ({ browser }) => {
  business = await seedDinerBusiness();
  context = await browser.newContext({
    ...contextOptions(test.info().project.use),
    baseURL: origin
  });
  page = await context.newPage();
});

test.afterAll(async () => {
  await context?.close();
  await business?.close();
});

const menu = () => page.getByText("Hacer el pedido", { exact: true });

test("a guest orders without an account and the menu never waits for the login", async () => {
  // Even if the account service were slow, the menu is already there.
  await page.route("**/api/diner/**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    await route.continue();
  });
  await page.goto(`/m/${business.tokens.get("5")!}`);
  await expect(menu()).toBeVisible({ timeout: 2_500 });
  // The prompt arrives later than the menu, after the (deliberately slow) checks.
  await expect(
    page.getByRole("button", { name: "Continuar sin cuenta" })
  ).toBeVisible({ timeout: 20_000 });

  await page.getByRole("button", { name: "Continuar sin cuenta" }).click();
  await expect(
    page.getByRole("button", { name: "Continuar sin cuenta" })
  ).toHaveCount(0);
  await expect(menu()).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Ingresar con Google (opcional)" })
  ).toBeVisible();
  expect(await business.profileNames()).toEqual([]);
  await page.unroute("**/api/diner/**");
});

test("a registered diner keeps the menu, creates a profile and manages separate consents", async () => {
  const email = "ana@e2e.example";
  await page.goto(`/m/${business.tokens.get("5")!}`);
  await expect(menu()).toBeVisible();
  // Declined in this tab, the login stays reachable through the quiet link.
  await page
    .getByRole("button", { name: /Ingresar con Google/u })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Google (simulado)" })
  ).toBeVisible();
  await page.getByLabel("Correo").fill(`fake:${email}`);
  await page.getByRole("button", { name: "Continuar", exact: true }).click();

  // Back on the menu, still usable while the profile is pending.
  await expect(page).toHaveURL(
    new RegExp(`/m/${business.tokens.get("5")!}$`, "u")
  );
  await expect(menu()).toBeVisible();
  await page.getByLabel("Tu nombre en este local").fill("Ana");
  await page.getByRole("button", { name: "Crear mi perfil" }).click();
  await expect(page.getByText("Hola, Ana")).toBeVisible();
  await expect(menu()).toBeVisible();

  // The restaurant side never carries the email.
  const me = await page.request.get("/api/diner/me");
  expect(me.ok()).toBe(true);
  expect(await me.text()).not.toContain(email);

  await page.getByRole("link", { name: "Mi cuenta" }).click();
  await expect(page.getByRole("heading", { name: "Tu cuenta" })).toBeVisible();

  const marketing = page.getByLabel(/Novedades y promociones/u);
  const whatsapp = page.getByLabel(/Avisos por WhatsApp/u);
  await expect(marketing).not.toBeChecked();
  await expect(whatsapp).not.toBeChecked();

  await marketing.click();
  await expect(marketing).toBeChecked();
  await expect(whatsapp).not.toBeChecked();

  // WhatsApp is its own consent and needs a phone.
  await whatsapp.click();
  await expect(page.getByText(/hace falta un teléfono/u)).toBeVisible();
  await page.getByLabel(/Teléfono para WhatsApp/u).fill("+5491112345678");
  await page.getByRole("button", { name: "Guardar perfil" }).click();
  await expect(page.getByText("Guardamos tu perfil.")).toBeVisible();
  await whatsapp.click();
  await expect(whatsapp).toBeChecked();

  await marketing.click();
  await expect(marketing).not.toBeChecked();
  await expect(whatsapp).toBeChecked();
  expect(await business.consentActions("Ana")).toEqual([
    "marketing:granted",
    "whatsapp_verified:granted",
    "marketing:revoked"
  ]);

  // The diner can take their own data with them.
  const exported = await page.evaluate(async () =>
    (await fetch("/api/diner/export")).json()
  );
  expect(exported.data.account.email).toBe(email);
  expect(exported.data.restaurants).toHaveLength(1);
  expect(exported.data.restaurants[0].consents).toHaveLength(3);
});

test("a session of one restaurant is worthless at another", async () => {
  const cookies = await context.cookies();
  const session = cookies.find((cookie) => cookie.name === "diner_session");
  expect(session).toBeDefined();
  expect(session!.httpOnly).toBe(true);
  const stolen = await page.request.get(
    `http://e2e-other.localhost:${webPort}/api/diner/me`,
    { headers: { cookie: `diner_session=${session!.value}` } }
  );
  expect(stolen.status()).toBe(401);
});

test("the open session of the group is joined as a session, not as a table", async () => {
  const sessionId = await business.openSession(tables.mateA);
  // The QR of the other table of the group resolves the very same session.
  await page.goto(`/m/${business.tokens.get("18")!}`);
  await expect(page.getByText("Hola, Ana")).toBeVisible();
  await expect
    .poll(() => business.linkedSessions("Ana"), { timeout: 20_000 })
    .toEqual([sessionId]);
});

test("deleting the account anonymizes it and the menu keeps working", async () => {
  await page.goto(`/m/${business.tokens.get("5")!}`);
  await page.getByRole("link", { name: "Mi cuenta" }).click();
  await page.getByRole("button", { name: "Borrar mi cuenta" }).click();
  await page.getByRole("button", { name: "Sí, borrar mi cuenta" }).click();
  await expect(page).toHaveURL(/\/m\//u);
  await expect(menu()).toBeVisible();
  await expect(page.getByText("Hola, Ana")).toHaveCount(0);

  expect(await business.accountByEmail("ana@e2e.example")).toBeNull();
  // The history survives: the session link still points at the session.
  expect(await business.linkedSessions("Comensal anonimizado")).toHaveLength(1);
  expect(await business.consentActions("Comensal anonimizado")).toEqual([
    "marketing:granted",
    "whatsapp_verified:granted",
    "marketing:revoked",
    "whatsapp_verified:revoked"
  ]);
  const me = await page.request.get("/api/diner/me");
  expect(me.status()).toBe(401);
});

test("the host is the only thing that names the restaurant", async () => {
  const response = await page.request.post("/api/diner/session-links", {
    data: { token: "a".repeat(64), tenantId: "x" },
    headers: { "sec-fetch-site": "same-origin" }
  });
  expect([400, 401]).toContain(response.status());
});
