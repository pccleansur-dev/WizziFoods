import { defineConfig, devices } from "@playwright/test";

import { apiPort, e2eHostname, stackEnv, webPort } from "./stack-env";

/**
 * The same stack, but the web is the PRODUCTION build (`next start`), the only place the
 * service worker caches. Build it first with `pnpm e2e:production` (see the runbook
 * pwa-y-tiempo-real.md). The journeys live in `*.production.spec.ts`.
 */
export default defineConfig({
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: false,
  projects: [
    {
      name: "mobile",
      use: { ...devices["Pixel 5"], viewport: { height: 812, width: 375 } }
    },
    { name: "desktop", use: { ...devices["Desktop Chrome"] } }
  ],
  reporter: [["list"]],
  testDir: ".",
  testMatch: "**/*.production.spec.ts",
  use: {
    baseURL: `http://${e2eHostname}:${webPort}`,
    trace: "retain-on-failure"
  },
  webServer: [
    {
      command: "node ./node_modules/tsx/dist/cli.mjs src/main.ts",
      cwd: "../apps/api",
      env: stackEnv(),
      reuseExistingServer: true,
      timeout: 60_000,
      url: `http://localhost:${apiPort}/health`
    },
    {
      command: `corepack pnpm exec next start -p ${webPort}`,
      cwd: "../apps/web",
      env: stackEnv(),
      reuseExistingServer: false,
      timeout: 120_000,
      url: `http://${e2eHostname}:${webPort}/acceso`
    }
  ],
  workers: 1
});
