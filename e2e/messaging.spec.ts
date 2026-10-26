import { createHmac } from "node:crypto";

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
import {
  seedMessagingBusiness,
  type MessagingBusiness
} from "./messaging-data";
import { apiPort, contextOptions, stackEnv, webPort } from "./stack-env";

const origin = `http://${adjustmentsHostname}:${webPort}`;
const base = `${origin}/interno/${adjustmentsSlug}/operacion`;
const accessToken = "EAAG-e2e-whatsapp-token-0123456789";

let business: MessagingBusiness;
const contexts: BrowserContext[] = [];

test.describe.configure({ mode: "serial", timeout: 240_000 });

test.beforeAll(async () => {
  business = await seedMessagingBusiness();
  await business.newDiner("Lucía", "+5491155550101");
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

/** A click that lands before React hydrates is lost; each step here is idempotent. */
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

/** What Meta would send to the webhook, signed with the app secret. */
async function postWebhook(body: unknown) {
  const raw = JSON.stringify(body);
  const secret = stackEnv().WHATSAPP_APP_SECRET!;
  const response = await fetch(
    `http://localhost:${apiPort}/v1/webhooks/whatsapp`,
    {
      body: raw,
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`
      },
      method: "POST"
    }
  );
  return response.status;
}

test("the manager connects, approves, confirms and sees BAJA stop a promotion", async ({
  browser
}) => {
  // The waiter has no access to messaging.
  const waiter = await signInStaff(browser, "ana");
  await waiter.goto(`${base}/mensajeria`);
  await expect(waiter).toHaveURL(/\/operacion$/u);
  await expect(
    waiter.getByRole("link", { name: /Abrir Mensajería/u })
  ).toHaveCount(0);

  // 1. The manager opens the module from the home.
  const manager = await signInStaff(browser, "marta");
  await manager.getByRole("link", { name: "Abrir Mensajería" }).click();
  await expect(
    manager.getByRole("heading", { name: "Mensajería", level: 1 })
  ).toBeVisible();

  // 2. Connects the number: the token is typed once and never shown again.
  await manager.getByLabel("ID del número de teléfono").fill("70000000001");
  await manager
    .getByLabel("ID de la cuenta de WhatsApp Business")
    .fill("80000000001");
  await manager.getByLabel(/^Número visible/u).fill("+5491100000099");
  await manager.getByLabel("Token de acceso").fill(accessToken);
  const connect = manager.getByRole("button", { name: "Conectar WhatsApp" });
  await hydrated(connect);
  await clickUntil(connect, () =>
    expect(manager.getByText(/Número conectado/u)).toBeVisible({
      timeout: 2_000
    })
  );
  await expect(manager.getByText(accessToken)).toHaveCount(0);
  expect(await business.connections()).toBe(1);
  expect(
    (await business.storedCredential())!.includes(Buffer.from(accessToken))
  ).toBe(false);

  // Real sending is off by default.
  await expect(manager.getByLabel("Envíos activados")).not.toBeChecked();
  await expect(manager.getByText(/Los envíos están apagados/u)).toBeVisible();

  // 3. Templates came from the (simulated) provider.
  const templates = manager.getByRole("region", { name: "Plantillas" });
  await expect(templates.getByText("premio_ganado", { exact: true })).toBeVisible();
  await expect(templates.getByText("novedad_en_revision", { exact: true })).toBeVisible();

  // 4. A permanent automation waits for one approval.
  const automations = manager.getByRole("region", { name: "Automatizaciones" });
  await automations
    .getByLabel("Plantilla de Premio ganado")
    .selectOption({ label: "premio_ganado (Operativa)" });
  await automations
    .getByRole("button", { name: "Guardar plantilla de Premio ganado" })
    .click();
  await expect(automations.getByText("Pendiente de aprobación")).toBeVisible();
  await automations
    .getByRole("button", { name: "Aprobar Premio ganado" })
    .click();
  await expect(
    automations.getByRole("button", { name: "Pausar Premio ganado" })
  ).toBeVisible();

  // 5. A one-off promotion is prepared first and sent only once confirmed.
  const oneOff = manager.getByRole("region", { name: "Evento puntual" });
  await oneOff
    .getByLabel("Plantilla del evento")
    .selectOption({ label: "feliz_cumple (Promocional)" });
  await oneOff.getByLabel("Lucía").check();
  await oneOff.getByRole("button", { name: "Preparar envío" }).click();
  await expect(oneOff.getByText(/Falta tu confirmación/u)).toBeVisible();
  expect(await business.outbox("Lucía")).toEqual([
    { lastError: null, status: "awaiting_confirmation" }
  ]);
  await oneOff.getByRole("button", { name: "Confirmar envío" }).click();
  await expect(oneOff.getByText(/Falta tu confirmación/u)).toHaveCount(0);
  expect(await business.outbox("Lucía")).toEqual([
    { lastError: null, status: "queued" }
  ]);
  const log = manager.getByRole("region", { name: "Registro de envíos" });
  await log.getByRole("button", { name: "Actualizar registro" }).click();
  await expect(log.getByRole("row", { name: /Lucía.*En cola/u })).toBeVisible();

  // 6. Lucía answers BAJA through the signed webhook: the promotion is blocked at once.
  expect(
    await postWebhook({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: "5491155550101",
                    id: `wamid.E2E${Date.now()}`,
                    text: { body: "BAJA" },
                    type: "text"
                  }
                ],
                metadata: { phone_number_id: "70000000001" }
              }
            }
          ]
        }
      ],
      object: "whatsapp_business_account"
    })
  ).toBe(200);
  expect(await postWebhook({ object: "whatsapp_business_account" })).toBe(200);
  expect(await business.marketing("Lucía")).toEqual({
    granted: false,
    source: "whatsapp_optout"
  });
  expect(await business.outbox("Lucía")).toEqual([
    { lastError: "opt_out", status: "blocked" }
  ]);
  await log.getByRole("button", { name: "Actualizar registro" }).click();
  await expect(
    log.getByRole("row", {
      name: /Lucía.*Bloqueado.*La persona respondió BAJA/u
    })
  ).toBeVisible();

  // 7. A forged notification is refused.
  const forged = await fetch(
    `http://localhost:${apiPort}/v1/webhooks/whatsapp`,
    {
      body: JSON.stringify({ object: "whatsapp_business_account" }),
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": `sha256=${"0".repeat(64)}`
      },
      method: "POST"
    }
  );
  expect(forged.status).toBe(401);

  // 8. Disconnecting removes the credential.
  await manager.getByRole("button", { name: "Desconectar número" }).click();
  await manager.getByRole("button", { name: "Sí, desconectar" }).click();
  await expect(
    manager.getByRole("button", { name: "Conectar WhatsApp" })
  ).toBeVisible();
  expect(await business.connections()).toBe(0);
});
