/*
 * Minimum load test: the public paths a dining room hits all at once at lunch.
 *
 *   pnpm exec tsx e2e/load-smoke.ts [--api http://localhost:3101] [--users 40] [--seconds 20]
 *
 * Seeds a throwaway business, then N virtual diners loop through: scan the QR (table
 * entry), read the menu, read the order options, and open the table
 * channel token. Reports requests per second, p50/p95/p99 and errors per path, and exits
 * non-zero when a threshold is broken. Run it against the API of this repository (or a
 * staging one) before every release; the numbers go in the release checklist.
 *
 * Thresholds (override with env): P95_MS=800, MAX_ERROR_RATE=0.
 */
import http from "node:http";

import { seedConnectivityBusiness } from "./connectivity-data";
import { adjustmentsHostname } from "./adjustments-data";
import { apiPort, webPort } from "./stack-env";

function option(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

const api = option("api", `http://localhost:${apiPort}`);
const users = Number(option("users", "40"));
const seconds = Number(option("seconds", "20"));
const p95Limit = Number(process.env.P95_MS ?? 800);
const maxErrorRate = Number(process.env.MAX_ERROR_RATE ?? 0);

type Sample = { ms: number; ok: boolean };
const samples = new Map<string, Sample[]>();

async function timed(
  name: string,
  request: () => Promise<{ ok: boolean; status: number }>,
  accept: (response: { ok: boolean; status: number }) => boolean = (response) =>
    response.ok
) {
  const started = performance.now();
  let ok = false;
  try {
    ok = accept(await request());
  } catch {
    ok = false;
  }
  const list = samples.get(name) ?? [];
  list.push({ ms: performance.now() - started, ok });
  samples.set(name, list);
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return (
    sorted[
      Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
    ] ?? 0
  );
}

async function main() {
  const business = await seedConnectivityBusiness();
  const host = `${adjustmentsHostname}:${webPort}`;
  const token = business.token;
  const target = new URL(api);
  const agent = new http.Agent({ keepAlive: true, maxSockets: users * 2 });
  // fetch() does not let a script choose the Host header, and the API tells the business
  // apart by it (as the reverse proxy does in production), so use the raw client.
  const call = (method: string, path: string, body?: unknown) =>
    new Promise<{ ok: boolean; status: number }>((resolve, reject) => {
      const payload = body === undefined ? null : JSON.stringify(body);
      const request = http.request(
        {
          agent,
          headers: {
            host,
            ...(payload
              ? {
                  "content-length": Buffer.byteLength(payload),
                  "content-type": "application/json"
                }
              : {})
          },
          hostname: target.hostname,
          method,
          path,
          port: target.port
        },
        (response) => {
          response.resume();
          response.on("end", () =>
            resolve({
              ok: (response.statusCode ?? 0) < 400,
              status: response.statusCode ?? 0
            })
          );
        }
      );
      request.on("error", reject);
      request.end(payload);
    });
  const post = (path: string, body: unknown) => call("POST", path, body);
  const get = (path: string) => call("GET", path);

  const deadline = Date.now() + seconds * 1_000;
  async function diner() {
    while (Date.now() < deadline) {
      await timed("table entry (QR scan)", () =>
        post("/v1/public/table-entry", { token })
      );
      await timed("menu", () => get("/v1/public/catalog"));
      await timed("order options", () =>
        get("/v1/public/order-intents/options")
      );
      await timed(
        "table channel token",
        () => post("/v1/public/realtime/token", { token }),
        // Without the JWT secret the feature is off (503): that is a valid answer.
        (response) => response.ok || response.status === 503
      );
      await timed("liveness", () => get("/health"));
      await timed("readiness", () => get("/ready"));
    }
  }

  console.info(`${users} diners for ${seconds} s against ${api}`);
  const started = Date.now();
  await Promise.all(Array.from({ length: users }, diner));
  const elapsed = (Date.now() - started) / 1_000;
  await business.close();

  let failed = false;
  let total = 0;
  console.info(
    "\npath                        reqs    rps    p50    p95    p99   errors"
  );
  for (const [name, list] of samples) {
    const times = list.map(({ ms }) => ms);
    const errors = list.filter(({ ok }) => !ok).length;
    total += list.length;
    const p95 = percentile(times, 95);
    const rate = errors / list.length;
    const bad = p95 > p95Limit || rate > maxErrorRate;
    failed ||= bad;
    console.info(
      `${name.padEnd(26)} ${String(list.length).padStart(6)} ${(list.length / elapsed).toFixed(0).padStart(6)} ${percentile(times, 50).toFixed(0).padStart(6)} ${p95.toFixed(0).padStart(6)} ${percentile(times, 99).toFixed(0).padStart(6)} ${String(errors).padStart(6)}${bad ? "   <-- over the limit" : ""}`
    );
  }
  console.info(
    `\n${total} requests in ${elapsed.toFixed(1)} s (${(total / elapsed).toFixed(0)} rps). ${failed ? "LOAD SMOKE FAILED" : "LOAD SMOKE PASSED"} (p95 <= ${p95Limit} ms, errors <= ${maxErrorRate * 100} %)`
  );
  process.exit(failed ? 1 : 0);
}

void main();
