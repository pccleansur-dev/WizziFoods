import { defineConfig, devices } from "@playwright/test";

import { apiPort, e2eHostname, stackEnv, webPort } from "./stack-env";

/**
 * Journeys that need the real stack: local Supabase (`pnpm infra:up`) plus the
 * API and the web, which this config starts on side ports so a running demo is
 * left alone. Each spec seeds its own throwaway business and removes it.
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
  testIgnore: "**/*.production.spec.ts",
  testMatch: "**/*.spec.ts",
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
      command: `corepack pnpm exec next dev --webpack -p ${webPort}`,
      cwd: "../apps/web",
      env: stackEnv(),
      reuseExistingServer: true,
      timeout: 120_000,
      url: `http://${e2eHostname}:${webPort}/acceso`
    }
  ],
  workers: 1
});
