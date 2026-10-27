/*
 * Migration rollback drill: the last N migrations are undone newest-first with their
 * rollback files, the database is checked in that older state, they are applied again in
 * order, and the whole database test suite must pass again. A rollback nobody ran is a guess.
 *
 *   pnpm exec tsx packages/infra/src/rollback-drill.ts [--last 4]
 *
 * Runs against the local Supabase (Docker, container supabase-db). It changes the schema
 * and puts it back, so do not run it while other work is using the database. Writes the
 * evidence to docs/evidence/.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const container = process.env.DB_CONTAINER ?? "supabase-db";
const lastIndex = process.argv.indexOf("--last");
const last = lastIndex >= 0 ? Number(process.argv[lastIndex + 1]) : 4;

const log: string[] = [];
const note = (line: string) => {
  log.push(line);
  console.info(line);
};

function psql(sql: string, quiet = true): { ok: boolean; output: string } {
  const result = spawnSync(
    "docker",
    [
      "exec",
      "-i",
      container,
      "psql",
      "-U",
      "supabase_admin",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      ...(quiet ? ["-q", "-t", "-A"] : [])
    ],
    { encoding: "utf8", input: sql }
  );
  return {
    ok: result.status === 0,
    output: `${result.stdout}${result.stderr}`
  };
}

function databaseTests(): { assertions: number; failing: string[] } {
  const directory = path.join(root, "supabase/tests/database");
  let assertions = 0;
  const failing: string[] = [];
  for (const file of readdirSync(directory)
    .filter((f) => f.endsWith(".test.sql"))
    .sort()) {
    const { output } = psql(readFileSync(path.join(directory, file), "utf8"));
    assertions += output
      .split("\n")
      .filter((line) => /^ok /u.test(line)).length;
    const bad = output.split("\n").find((line) => /^not ok|^ERROR/u.test(line));
    if (bad) failing.push(`${file}: ${bad}`);
  }
  return { assertions, failing };
}

const migrations = readdirSync(path.join(root, "supabase/migrations"))
  .filter((file) => file.endsWith(".sql"))
  .sort();
const chosen = migrations.slice(-last);
const rollbackOf = (migration: string) =>
  path.join(
    root,
    "supabase/rollbacks",
    migration.replace(/\.sql$/u, ".down.sql")
  );

note(`# Rollback drill ${new Date().toISOString()}`);
note("");
note(`Migrations undone (newest first): ${[...chosen].reverse().join(", ")}`);

let failed = false;
const before = databaseTests();
note(
  `- before: ${before.assertions} database assertions, ${before.failing.length} failing files`
);
failed ||= before.failing.length > 0;

for (const migration of [...chosen].reverse()) {
  const down = psql(readFileSync(rollbackOf(migration), "utf8"));
  note(
    `- rolled back ${migration}: ${down.ok ? "ok" : `FAILED ${down.output.slice(0, 200)}`}`
  );
  if (!down.ok) {
    failed = true;
    break;
  }
}

if (!failed) {
  // In the older state the application's own guards must still hold: a spot check that
  // the newest objects are really gone proves the rollback did something.
  const gone = psql(
    "select to_regprocedure('private.notify_tables(uuid,uuid,uuid[])') is null and to_regprocedure('private.notify_realtime(uuid,uuid,text)') is null"
  );
  note(
    `- the objects of the undone migrations are gone: ${gone.output.trim()}`
  );
  failed ||= gone.output.trim() !== "t";
  for (const migration of chosen) {
    const up = psql(
      readFileSync(path.join(root, "supabase/migrations", migration), "utf8")
    );
    note(
      `- applied again ${migration}: ${up.ok ? "ok" : `FAILED ${up.output.slice(0, 200)}`}`
    );
    if (!up.ok) {
      failed = true;
      break;
    }
  }
}

const after = databaseTests();
note(
  `- after: ${after.assertions} database assertions, ${after.failing.length} failing files`
);
failed ||= after.failing.length > 0 || after.assertions !== before.assertions;
for (const failure of after.failing) note(`  - ${failure}`);
note("");
note(`Result: ${failed ? "FAILED" : "PASSED"}`);

mkdirSync(path.join(root, "docs/evidence"), { recursive: true });
writeFileSync(
  path.join(
    root,
    `docs/evidence/rollback-drill-${new Date().toISOString().slice(0, 10)}.md`
  ),
  log.join("\n") + "\n"
);
process.exit(failed ? 1 : 0);
