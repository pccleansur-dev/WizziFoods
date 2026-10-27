import { spawnSync } from "node:child_process";
import path from "node:path";

import { stackEnv } from "./stack-env";

/** Builds the web with the e2e environment so `next start` serves the production bundle. */
const result = spawnSync("corepack", ["pnpm", "exec", "next", "build", "--webpack"], {
  cwd: path.resolve(__dirname, "../apps/web"),
  env: { ...process.env, ...stackEnv(), NODE_ENV: "production" },
  shell: true,
  stdio: "inherit"
});
process.exit(result.status ?? 1);
