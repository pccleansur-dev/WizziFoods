/*
 * Failed-deployment drill: a bad release must never take traffic from the good one.
 *
 *   pnpm exec tsx e2e/failed-deploy-drill.ts
 *
 * The deployment platform (Coolify) only switches traffic to a new container once its health
 * check passes, and the check is `/ready`. This drill starts the CURRENT release, then two
 * broken "new releases" and shows what the platform would see:
 *   1. the new release cannot reach the database: alive (/health 200) but NOT ready (/ready 503),
 *      with no host, user or password in the answer;
 *   2. the new release is missing a required variable: it exits at start, so it never
 *      listens at all;
 * while the current release keeps answering 200 on /ready the whole time.
 * Writes the evidence to docs/evidence/.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { stackEnv } from "./stack-env";

const root = path.resolve(__dirname, "..");
const log: string[] = [];
const note = (line: string) => {
  log.push(line);
  console.info(line);
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function start(env: Record<string, string | undefined>): {
  child: ChildProcess;
  exited: Promise<number | null>;
} {
  const child = spawn(
    "node",
    [path.join(root, "node_modules/tsx/dist/cli.mjs"), "src/main.ts"],
    {
      cwd: path.join(root, "apps/api"),
      env: { ...process.env, ...env } as NodeJS.ProcessEnv,
      stdio: "ignore"
    }
  );
  return { child, exited: new Promise((resolve) => child.on("exit", resolve)) };
}

async function status(port: number, route: string) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}${route}`);
    return { body: await response.text(), status: response.status };
  } catch {
    return { body: "", status: 0 };
  }
}

async function waitFor(port: number, route: string) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if ((await status(port, route)).status !== 0) return;
    await sleep(1_000);
  }
  throw new Error(`nothing answered on ${port}`);
}

async function main() {
  const base = stackEnv();
  const current = start({
    ...base,
    API_METRICS_PORT: "9591",
    API_PORT: "3191"
  });
  const procs: ChildProcess[] = [current.child];
  let failed = false;
  const check = (what: string, ok: boolean) => {
    note(`- [${ok ? "x" : " "}] ${ok ? "" : "**FAILED** "}${what}`);
    failed ||= !ok;
  };
  try {
    note(`# Failed deployment drill ${new Date().toISOString()}`);
    note("");
    await waitFor(3191, "/health");
    check(
      "current release: /health 200 and /ready 200",
      (await status(3191, "/health")).status === 200 &&
        (await status(3191, "/ready")).status === 200
    );

    // 1. The new release cannot reach its database.
    const brokenUrl = base.DATABASE_URL!.replace(/@[^/]+\//u, "@127.0.0.1:1/");
    const bad = start({
      ...base,
      API_METRICS_PORT: "9592",
      API_PORT: "3192",
      DATABASE_URL: brokenUrl
    });
    procs.push(bad.child);
    await waitFor(3192, "/health");
    const alive = await status(3192, "/health");
    const ready = await status(3192, "/ready");
    check(
      "new release without a database: process alive (/health 200)",
      alive.status === 200
    );
    check(
      "new release without a database: NOT ready (/ready 503), so no traffic is switched",
      ready.status === 503
    );
    check(
      "the 503 reveals no host, port, user or password",
      !/127\.0\.0\.1|ECONN|password|postgres/iu.test(ready.body) &&
        JSON.parse(ready.body).checks?.database === "unavailable"
    );
    check(
      "meanwhile the current release keeps serving (/ready 200)",
      (await status(3191, "/ready")).status === 200
    );
    bad.child.kill();

    // 2. The new release misses a required variable: it refuses to start.
    const { SUPABASE_SECRET_KEY: _omitted, ...incomplete } = base;
    const broken = start({
      ...incomplete,
      API_METRICS_PORT: "9593",
      API_PORT: "3193"
    });
    procs.push(broken.child);
    const code = await Promise.race([
      broken.exited,
      sleep(30_000).then(() => "timeout" as const)
    ]);
    check(
      `new release missing a required variable exits at start (exit code ${String(code)}) and never listens`,
      typeof code === "number" &&
        code !== 0 &&
        (await status(3193, "/health")).status === 0
    );
    check(
      "and the current release is still ready",
      (await status(3191, "/ready")).status === 200
    );
  } finally {
    for (const child of procs) child.kill();
  }
  note("");
  note(`Result: ${failed ? "FAILED" : "PASSED"}`);
  mkdirSync(path.join(root, "docs/evidence"), { recursive: true });
  writeFileSync(
    path.join(
      root,
      `docs/evidence/failed-deploy-drill-${new Date().toISOString().slice(0, 10)}.md`
    ),
    log.join("\n") + "\n"
  );
  process.exit(failed ? 1 : 0);
}

void main();
