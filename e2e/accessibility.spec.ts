import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page
} from "@playwright/test";

import {
  adjustmentsHostname,
  adjustmentsPin,
  adjustmentsSlug
} from "./adjustments-data";
import {
  seedConnectivityBusiness,
  type ConnectivityBusiness
} from "./connectivity-data";
import {
  panelHostname,
  seedPanelBusiness,
  type PanelBusiness
} from "./panel-data";
import { contextOptions, webPort } from "./stack-env";

/**
 * WCAG 2.2 AA on the journeys that matter: what axe can verify by itself (names, roles,
 * contrast, labels, landmarks, target size) on the diner, the staff screens and the
 * public pages, in a phone and in a desktop. What a machine cannot judge (reading order
 * with a screen reader, meaning of the texts) is in the manual matrix of the runbook.
 */
const origin = `http://${adjustmentsHostname}:${webPort}`;
const tags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

let business: ConnectivityBusiness;
let panel: PanelBusiness;
const contexts: BrowserContext[] = [];

test.describe.configure({ timeout: 120_000 });

test.beforeAll(async () => {
  business = await seedConnectivityBusiness();
  panel = await seedPanelBusiness();
});

test.afterEach(async () => {
  for (const context of contexts.splice(0)) await context.close();
});

test.afterAll(async () => {
  await business?.close();
  await panel?.close();
});

async function fresh(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    ...contextOptions(test.info().project.use),
    baseURL: origin
  });
  contexts.push(context);
  return context.newPage();
}

async function staff(browser: Browser, username: string): Promise<Page> {
  const page = await fresh(browser);
  await page.goto(`${origin}/interno/${adjustmentsSlug}`);
  await page.getByLabel("Usuario").fill(username);
  await page.getByLabel("PIN de 6 dígitos").fill(adjustmentsPin);
  await page.getByRole("button", { name: "Entrar a la operación" }).click();
  await expect(page).toHaveURL(/\/operacion$/u);
  return page;
}

/** Fails with a readable list of what is wrong, where and why. */
async function clean(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).withTags(tags).analyze();
  const problems = result.violations.map(
    (violation) =>
      `${violation.id} (${violation.impact}): ${violation.help}\n` +
      violation.nodes
        .slice(0, 4)
        .map(
          (node) =>
            `    ${node.target.join(" ")}  ${node.failureSummary?.split("\n")[1] ?? ""}`
        )
        .join("\n")
  );
  expect.soft(problems, `${label}\n${problems.join("\n")}`).toEqual([]);
}

test("the public pages are accessible", async ({ browser }) => {
  const page = await fresh(browser);
  for (const path of ["/acceso", "/offline.html", "/cuenta"]) {
    await page.goto(`${origin}${path}`);
    await clean(page, path);
  }
  await page.goto(`${origin}/interno/${adjustmentsSlug}`);
  await clean(page, "staff sign-in");
});

test("the diner's journey is accessible, step by step", async ({ browser }) => {
  const page = await fresh(browser);
  await page.goto(`${origin}/m/${business.token}`);
  await clean(page, "diner entry");
  await page.getByRole("button", { name: "Carta", exact: true }).click();
  await clean(page, "diner menu");
  await page.getByRole("button", { name: "Ver detalle de Milanesa" }).click();
  await clean(page, "product detail");
  await page.getByRole("button", { name: "Agregar a Mi pedido" }).click();
  await page.getByRole("button", { name: /^Mi pedido/u }).click();
  await clean(page, "my order");
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await clean(page, "checkout");
  await page.getByRole("button", { name: "Dividir la cuenta" }).click();
  await clean(page, "split the account");
});

test("the waiter's screens are accessible", async ({ browser }) => {
  await business.placeOrder("5", ["milanesa"]);
  const page = await staff(browser, "ana");
  await page.goto(`${origin}/interno/${adjustmentsSlug}/operacion/salon`);
  await expect(
    page.getByRole("heading", { name: "Llamados y pedidos por validar" })
  ).toBeVisible();
  await clean(page, "salon: calls");
  for (const view of ["comanda", "cuentas", "pedidos", "salon"]) {
    await page.goto(
      `${origin}/interno/${adjustmentsSlug}/operacion/salon?vista=${view}`
    );
    await expect(page.locator("main")).toBeVisible({ timeout: 30_000 });
    await clean(page, `salon: ${view}`);
  }
});

test("the kitchen, the bar and the manager's screens are accessible", async ({
  browser
}) => {
  const kitchen = await staff(browser, "coco");
  await kitchen.goto(
    `${origin}/interno/${adjustmentsSlug}/operacion/produccion`
  );
  await expect(kitchen.getByRole("heading", { name: "Cocina" })).toBeVisible();
  await clean(kitchen, "kitchen");
  const bar = await staff(browser, "beto");
  await bar.goto(`${origin}/interno/${adjustmentsSlug}/operacion/produccion`);
  await expect(bar.getByRole("heading", { name: "Barra" })).toBeVisible();
  await clean(bar, "bar");
  const manager = await staff(browser, "marta");
  for (const path of ["salon?vista=caja", "mensajeria"]) {
    await manager.goto(
      `${origin}/interno/${adjustmentsSlug}/operacion/${path}`
    );
    await expect(manager.locator("main")).toBeVisible({ timeout: 30_000 });
    await clean(manager, `manager: ${path}`);
  }
});

test("the administrator's panel is accessible, from the sign-in to each section", async ({
  browser
}) => {
  const home = `http://${panelHostname}:${webPort}`;
  const context = await browser.newContext({
    ...contextOptions(test.info().project.use),
    baseURL: home
  });
  contexts.push(context);
  const page = await context.newPage();
  await page.goto(`${home}/acceso`);
  await page.getByLabel("Correo electrónico").fill(panel.email);
  await page.getByLabel("Contraseña", { exact: true }).fill(panel.password);
  await page.getByRole("button", { name: "Ingresar", exact: true }).click();
  await expect(page.getByLabel("Código de 6 dígitos")).toBeVisible({
    timeout: 30_000
  });
  await clean(page, "second factor");
  await page.getByLabel("Código de 6 dígitos").fill(panel.code());
  await page.getByRole("button", { name: "Verificar e ingresar" }).click();
  await expect(page).not.toHaveURL(/\/acceso/u, { timeout: 30_000 });

  for (const path of [
    "/panel",
    "/panel/negocio",
    "/panel/carta",
    "/panel/equipo",
    "/panel/pagos",
    "/panel/plano",
    "/panel/publicar"
  ]) {
    await page.goto(`${home}${path}`);
    await expect(page.locator("main")).toBeVisible({ timeout: 30_000 });
    await clean(page, path);
  }
});

/** Widths from a small phone to a wide desktop; 320 is a 1280 screen zoomed to 400 %. */
const widths = [320, 375, 768, 1024, 1440];

/** A navigation can be aborted by the page that is still refreshing itself: try again. */
async function open(page: Page, url: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      return;
    } catch (error) {
      if (attempt === 2) throw error;
      await page.waitForTimeout(500);
    }
  }
}

async function overflow(page: Page) {
  return page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    view: document.documentElement.clientWidth
  }));
}

test("nothing needs sideways scrolling at any width, nor shows tiny text", async ({
  browser
}) => {
  const diner = await fresh(browser);
  const waiter = await staff(browser, "ana");
  const kitchen = await staff(browser, "coco");
  const screens: Array<[string, Page, string]> = [
    ["diner", diner, `${origin}/m/${business.token}`],
    ["salon", waiter, `${origin}/interno/${adjustmentsSlug}/operacion/salon`],
    [
      "accounts",
      waiter,
      `${origin}/interno/${adjustmentsSlug}/operacion/salon?vista=cuentas`
    ],
    [
      "kitchen",
      kitchen,
      `${origin}/interno/${adjustmentsSlug}/operacion/produccion`
    ]
  ];
  for (const [name, page, url] of screens) {
    for (const width of widths) {
      await page.setViewportSize({ height: 800, width });
      await open(page, url);
      await expect(page.locator("main")).toBeVisible({ timeout: 30_000 });
      const { scroll, view } = await overflow(page);
      expect(
        scroll,
        `${name} at ${width}px scrolls sideways`
      ).toBeLessThanOrEqual(view);
      // Operational text a person must read stays readable (>= 12px).
      const tiny = await page.evaluate(() => {
        const found: string[] = [];
        const walker = document.createTreeWalker(
          document.body,
          NodeFilter.SHOW_TEXT
        );
        while (walker.nextNode()) {
          const node = walker.currentNode;
          const text = node.textContent?.trim() ?? "";
          const element = node.parentElement;
          if (!text || !element) continue;
          const style = getComputedStyle(element);
          if (style.visibility === "hidden" || style.display === "none")
            continue;
          if (
            element.closest(
              ".visually-hidden, script, style, [aria-hidden=true]"
            )
          )
            continue;
          if (Number.parseFloat(style.fontSize) < 12) {
            found.push(
              `${element.tagName.toLowerCase()}.${element.className}: ${text.slice(0, 30)}`
            );
          }
        }
        return found;
      });
      expect(tiny, `${name} at ${width}px has text under 12px`).toEqual([]);
    }
  }
});

test("everything important works with the keyboard alone", async ({
  browser
}) => {
  const page = await fresh(browser);
  await page.goto(`${origin}/m/${business.token}`);
  // Every control the diner needs is reachable with Tab and shows where the focus is.
  const carta = page.getByRole("button", { name: "Carta", exact: true });
  await carta.focus();
  await page.keyboard.press("Enter");
  const product = page.getByRole("button", { name: "Ver detalle de Milanesa" });
  await product.focus();
  const focusRing = await product.evaluate((element) => {
    const style = getComputedStyle(element);
    return (
      style.outlineStyle !== "none" &&
      Number.parseFloat(style.outlineWidth) >= 2
    );
  });
  expect(focusRing, "the focused product shows an outline").toBe(true);
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  // Focus moves into the dialog and Escape gives it back to what opened it.
  await expect
    .poll(() =>
      page.evaluate(() => Boolean(document.activeElement?.closest("dialog")))
    )
    .toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(product).toBeFocused();

  // The staff sign-in is a plain form: fields in order, Enter sends it.
  const staffPage = await fresh(browser);
  await staffPage.goto(`${origin}/interno/${adjustmentsSlug}`);
  await staffPage.getByLabel("Usuario").focus();
  await staffPage.keyboard.type("ana");
  await staffPage.keyboard.press("Tab");
  await staffPage.keyboard.type(adjustmentsPin);
  await staffPage.keyboard.press("Enter");
  await expect(staffPage).toHaveURL(/\/operacion$/u);
  await expect(staffPage.getByRole("heading", { level: 1 })).toContainText(
    "Hola"
  );
  // The first Tab stops on something that does something (the development overlay of
  // Next.js, which does not exist in production, may take one stop).
  let landed = "";
  for (
    let stop = 0;
    stop < 3 && !/^(A|BUTTON|INPUT) /u.test(landed);
    stop += 1
  ) {
    await staffPage.keyboard.press("Tab");
    landed = await staffPage.evaluate(() => {
      const element = document.activeElement;
      return element
        ? `${element.tagName} ${(element.textContent ?? "").slice(0, 30)}`
        : "none";
    });
  }
  expect(landed).toMatch(/^(A|BUTTON|INPUT) /u);
});
