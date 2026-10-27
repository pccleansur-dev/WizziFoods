/*
 * The security gate that must be green before a release.
 *
 *   pnpm security:gate [--web http://localhost:3100] [--api http://localhost:3001]
 *
 * Checks, in order:
 *   1. every database test (pgTap): RLS, tenant isolation, security posture, ledger rules;
 *   2. the hardening headers of a RUNNING web and API;
 *   3. known vulnerabilities in the production dependencies (needs network);
 *   4. committed secrets.
 * Prints one line per check and exits non-zero when any fails. Needs Docker with the local
 * Supabase for (1); against another database set DB_CONTAINER.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const dbContainer = process.env.DB_CONTAINER ?? "supabase-db";

function option(name: string, fallback: string | null): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

type Result = { detail: string; name: string; ok: boolean };
const results: Result[] = [];
const record = (name: string, ok: boolean, detail: string) => {
  results.push({ detail, name, ok });
  console.info(
    `${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`
  );
};

function databaseTests(): void {
  const directory = path.join(root, "supabase/tests/database");
  const files = readdirSync(directory)
    .filter((file) => file.endsWith(".test.sql"))
    .sort();
  let assertions = 0;
  const failing: string[] = [];
  for (const file of files) {
    const result = spawnSync(
      "docker",
      [
        "exec",
        "-i",
        dbContainer,
        "psql",
        "-U",
        "supabase_admin",
        "-d",
        "postgres",
        "-q",
        "-t",
        "-A"
      ],
      { encoding: "utf8", input: readFileSync(path.join(directory, file)) }
    );
    const output = `${result.stdout}\n${result.stderr}`;
    assertions += output
      .split("\n")
      .filter((line) => /^ok /u.test(line)).length;
    const bad = output
      .split("\n")
      .filter((line) => /^not ok|^ERROR/u.test(line));
    if (bad.length > 0 || result.status !== 0)
      failing.push(`${file}: ${bad[0] ?? "psql failed"}`);
  }
  record(
    "database tests (RLS, isolation, ledger, security posture)",
    failing.length === 0,
    failing.length === 0
      ? `${files.length} files, ${assertions} assertions`
      : failing.slice(0, 3).join("; ")
  );
}

async function headers(
  label: string,
  url: string,
  required: Array<[string, RegExp]>
) {
  try {
    const response = await fetch(url, { redirect: "manual" });
    const missing = required
      .filter(
        ([name, pattern]) => !pattern.test(response.headers.get(name) ?? "")
      )
      .map(([name]) => name);
    record(
      `${label} hardening headers`,
      missing.length === 0,
      missing.length === 0
        ? url
        : `missing or wrong on ${url}: ${missing.join(", ")}`
    );
  } catch {
    record(`${label} hardening headers`, false, `${url} does not answer`);
  }
}

async function main() {
  databaseTests();

  const web = option("web", null);
  const api = option("api", null);
  if (web) {
    await headers("web", `${web}/acceso`, [
      [
        "content-security-policy",
        /default-src 'self'.*frame-ancestors 'none'/u
      ],
      ["x-content-type-options", /^nosniff$/u],
      ["x-frame-options", /^DENY$/u],
      ["referrer-policy", /./u],
      ["permissions-policy", /camera=\(\)/u]
    ]);
  } else {
    record("web hardening headers", false, "pass --web <url> of a running web");
  }
  if (api) {
    await headers("api", `${api}/health`, [
      ["x-content-type-options", /^nosniff$/u],
      ["cache-control", /no-store/u],
      ["content-security-policy", /default-src 'none'/u]
    ]);
  } else {
    record("api hardening headers", false, "pass --api <url> of a running API");
  }

  const audit = spawnSync(
    "corepack",
    ["pnpm", "audit", "--prod", "--audit-level", "high"],
    {
      cwd: root,
      encoding: "utf8",
      shell: true
    }
  );
  record(
    "production dependencies without high or critical vulnerabilities",
    audit.status === 0,
    audit.status === 0
      ? "pnpm audit"
      : ((audit.stdout + audit.stderr)
          .split("\n")
          .find((line) => /vulnerab/iu.test(line)) ??
          "pnpm audit failed (offline?)")
  );

  const secrets = spawnSync("corepack", ["pnpm", "security:secrets"], {
    cwd: root,
    encoding: "utf8",
    shell: true
  });
  record(
    "no secrets committed",
    secrets.status === 0,
    (secrets.stdout.match(/\((\d+) files checked\)/u)?.[0] ?? "").replace(
      /[()]/gu,
      ""
    )
  );

  try {
    execFileSync("git", ["diff", "--quiet"], { cwd: root });
  } catch {
    console.info("note: the working tree has uncommitted changes");
  }

  const failed = results.filter((result) => !result.ok);
  console.info(
    `\n${failed.length === 0 ? "SECURITY GATE PASSED" : `SECURITY GATE FAILED (${failed.length})`}`
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

void main();
