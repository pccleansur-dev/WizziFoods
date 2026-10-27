/*
 * Incident drill: the monitoring stack must notice a real failure and tell somebody.
 *
 *   pnpm exec tsx e2e/incident-drill.ts
 *
 * It brings up Prometheus + Alertmanager + Grafana + the exporters, starts the API and
 * the worker of this repository, then KILLS the API and waits for `ApiDown` to reach the
 * alert receiver (a tiny HTTP server standing in for the team's channel); it restarts the
 * API and waits for the alert to resolve. Writes the evidence to docs/evidence/.
 * Needs the local Supabase (pnpm infra:up) and Docker.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";

import { ownerDatabaseUrl, stackEnv } from "./stack-env";

const root = path.resolve(__dirname, "..");
const compose = path.join(
  root,
  "infra/observability/docker-compose.observability.yml"
);
const received: Array<{ at: string; body: any }> = [];
const log: string[] = [];
const note = (line: string) => {
  const stamp = new Date().toISOString();
  log.push(`${stamp}  ${line}`);
  console.info(`${stamp}  ${line}`);
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until<T>(
  what: string,
  check: () => Promise<T | false | null | undefined>,
  ms: number
): Promise<T> {
  const start = Date.now();
  for (;;) {
    try {
      const value = await check();
      if (value) return value;
    } catch {
      // not yet
    }
    if (Date.now() - start > ms) throw new Error(`timeout waiting for ${what}`);
    await sleep(3_000);
  }
}

async function prometheus(query: string) {
  const response = await fetch(
    `http://127.0.0.1:9090/api/v1/query?query=${encodeURIComponent(query)}`
  );
  const body = (await response.json()) as {
    data: { result: Array<{ value: [number, string] }> };
  };
  return body.data.result;
}

function startService(cwd: string, env: Record<string, string>): ChildProcess {
  return spawn(
    "node",
    [path.join(root, "node_modules/tsx/dist/cli.mjs"), "src/main.ts"],
    {
      cwd: path.join(root, cwd),
      env: { ...process.env, ...env },
      stdio: "ignore"
    }
  );
}

async function main() {
  const base = stackEnv();
  const apiMetrics = 9574;
  const workerMetrics = 9575;
  const webMetrics = 9576;
  const env = {
    ...base,
    API_METRICS_PORT: String(apiMetrics),
    WEB_PUSH_MODE: "off",
    WHATSAPP_MODE: "off",
    WORKER_HEARTBEAT_MS: "5000",
    WORKER_METRICS_PORT: String(workerMetrics),
    WORKER_POLL_MS: "2000",
    WORKER_VISIBILITY_TIMEOUT_SECONDS: "30"
  };

  // The channel of the team, for the drill.
  const receiver = createServer((request, response) => {
    let data = "";
    request.on("data", (chunk) => (data += chunk));
    request.on("end", () => {
      try {
        received.push({ at: new Date().toISOString(), body: JSON.parse(data) });
      } catch {
        // ignore
      }
      response.end("ok");
    });
  }).listen(9999, "0.0.0.0");

  const work = mkdtempSync(path.join(os.tmpdir(), "obs-drill-"));
  const secrets = path.join(work, "secrets");
  mkdirSync(secrets);
  writeFileSync(
    path.join(secrets, "webhook_url"),
    "http://host.docker.internal:9999/alert"
  );
  // The same configuration, pointed at this machine's metrics ports.
  const config = readFileSync(
    path.join(root, "infra/observability/prometheus.yml"),
    "utf8"
  )
    .replace("host.docker.internal:9464", `host.docker.internal:${apiMetrics}`)
    .replace(
      "host.docker.internal:9465",
      `host.docker.internal:${workerMetrics}`
    )
    .replace("host.docker.internal:9466", `host.docker.internal:${webMetrics}`);
  writeFileSync(path.join(work, "prometheus.yml"), config);

  const stackEnvVars = {
    ...process.env,
    ALERT_SECRETS_DIR: secrets,
    GRAFANA_ADMIN_PASSWORD: randomBytes(12).toString("hex"),
    MONITORING_DATABASE_URL:
      ownerDatabaseUrl().replace("127.0.0.1", "host.docker.internal") +
      "?sslmode=disable",
    PROMETHEUS_CONFIG: path.join(work, "prometheus.yml")
  };
  const docker = (...args: string[]) =>
    execFileSync("docker", ["compose", "-f", compose, ...args], {
      env: stackEnvVars,
      stdio: ["ignore", "pipe", "pipe"]
    });

  let api: ChildProcess | null = null;
  let worker: ChildProcess | null = null;
  try {
    note("up: starting the monitoring stack");
    docker("up", "-d");
    note("up: starting the API and the worker of this repository");
    api = startService("apps/api", env);
    worker = startService("apps/worker", env);

    await until(
      "Prometheus to see the API up",
      async () =>
        (await prometheus('up{job="platform",service="api"}'))[0]?.value[1] ===
        "1",
      120_000
    );
    note("ok: Prometheus scrapes the API (up=1)");
    await until(
      "the worker heartbeat metric",
      async () =>
        (
          await prometheus(
            'platform_operations_total{service="worker",operation="worker.heartbeat"}'
          )
        ).length > 0,
      90_000
    );
    note("ok: the worker heartbeat is a metric");
    await until(
      "the business queries of the Postgres exporter",
      async () =>
        (await prometheus("platform_messaging_outbox_queued")).length > 0,
      90_000
    );
    note("ok: the Postgres exporter answers the business queries");
    const dashboards = await fetch(
      "http://127.0.0.1:3030/api/search?query=Plataforma",
      {
        headers: {
          authorization: `Basic ${Buffer.from(`admin:${stackEnvVars.GRAFANA_ADMIN_PASSWORD}`).toString("base64")}`
        }
      }
    );
    note(
      `ok: Grafana provisioned ${((await dashboards.json()) as unknown[]).length} dashboard(s)`
    );

    note("INCIDENT: killing the API");
    api.kill();
    api = null;
    const firing = await until(
      "ApiDown to reach the receiver",
      async () =>
        received.find((entry) =>
          entry.body.alerts?.some(
            (alert: any) =>
              alert.labels.alertname === "ApiDown" && alert.status === "firing"
          )
        ),
      300_000
    );
    note(`ALERT RECEIVED (ApiDown firing) at ${firing.at}`);

    note("RECOVERY: starting the API again");
    api = startService("apps/api", env);
    const resolved = await until(
      "ApiDown to resolve",
      async () =>
        received.find((entry) =>
          entry.body.alerts?.some(
            (alert: any) =>
              alert.labels.alertname === "ApiDown" &&
              alert.status === "resolved"
          )
        ),
      300_000
    );
    note(`ALERT RESOLVED (ApiDown) at ${resolved.at}`);

    mkdirSync(path.join(root, "docs/evidence"), { recursive: true });
    const target = path.join(
      root,
      `docs/evidence/incident-drill-${new Date().toISOString().slice(0, 10)}.md`
    );
    writeFileSync(
      target,
      [
        "# Simulacro de incidente: la API se cae",
        "",
        "Generado por `e2e/incident-drill.ts`. Qué se probó: el stack de monitoreo detecta una caída real, avisa al canal del equipo y avisa cuando se recupera.",
        "",
        "```text",
        ...log,
        "```",
        "",
        "Alertas recibidas en el canal:",
        "",
        "```json",
        JSON.stringify(
          received.map((entry) => ({
            at: entry.at,
            alerts: entry.body.alerts?.map((alert: any) => ({
              alertname: alert.labels.alertname,
              severity: alert.labels.severity,
              status: alert.status,
              summary: alert.annotations?.summary,
              runbook: alert.annotations?.runbook
            }))
          })),
          null,
          2
        ),
        "```",
        ""
      ].join("\n")
    );
    note(`evidence written to ${path.relative(root, target)}`);
  } catch (error) {
    // Say what Prometheus saw: a drill that fails must explain why.
    try {
      const targets = (await (
        await fetch("http://127.0.0.1:9090/api/v1/targets")
      ).json()) as {
        data: {
          activeTargets: Array<{
            scrapeUrl: string;
            health: string;
            lastError: string;
          }>;
        };
      };
      for (const t of targets.data.activeTargets) {
        console.error(`target ${t.scrapeUrl}: ${t.health} ${t.lastError}`);
      }
    } catch {
      console.error("Prometheus itself does not answer");
      try {
        console.error(
          execFileSync(
            "docker",
            ["compose", "-f", compose, "logs", "--tail", "15", "prometheus"],
            {
              env: stackEnvVars
            }
          ).toString()
        );
      } catch {
        // nothing more to say
      }
    }
    throw error;
  } finally {
    api?.kill();
    worker?.kill();
    receiver.close();
    try {
      docker("down", "-v");
    } catch {
      // already down
    }
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
