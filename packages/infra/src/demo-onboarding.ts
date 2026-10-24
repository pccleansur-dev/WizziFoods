/**
 * Entorno de prueba local para recorrer el alta de un negocio ficticio (T15).
 *
 *   pnpm demo:up      siembra un negocio vacío + Administrador (contraseña y TOTP) y levanta API, web y worker
 *   pnpm demo:totp    imprime el código TOTP vigente
 *   pnpm demo:reset   borra el negocio y el usuario de prueba (deja el alta otra vez desde cero)
 *   pnpm demo:down    detiene API, web y worker
 *
 * Sólo para desarrollo local: requiere Supabase local (infra:up). El usuario se
 * crea con la API admin de Supabase local y nada de esto se versiona: el estado
 * (contraseña y secreto TOTP) queda en .supabase/, ignorado por git.
 */
import { execFileSync, spawn } from "node:child_process";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import path from "node:path";

const root = process.cwd();
const stateDirectory = path.join(root, ".supabase");
const stateFile = path.join(stateDirectory, "demo-onboarding.json");
const supabaseUrl = "http://localhost:18000";
const hostname = "demo.localhost";
const email = "demo-admin@example.test";
const webPort = 3000;
const apiPort = 3001;

type DemoState = {
  password: string;
  pids: number[];
  secret: string;
  tenantId: string;
  userId: string;
};

function readEnvFile(file: string): Record<string, string> {
  const values: Record<string, string> = {};
  if (!existsSync(file)) return values;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/u)) {
    const match = /^([A-Z_0-9]+)=(.*)$/u.exec(line);
    if (match?.[1]) {
      values[match[1]] = (match[2] ?? "").replace(/^["']|["']$/gu, "");
    }
  }
  return values;
}

/** En una worktree los .env (ignorados) viven en el checkout principal. */
function mainCheckout(): string {
  try {
    const common = execFileSync("git", ["rev-parse", "--git-common-dir"], {
      cwd: root,
      encoding: "utf8"
    }).trim();
    return path.dirname(path.resolve(root, common));
  } catch {
    return root;
  }
}

function localEnv(...segments: string[]): Record<string, string> {
  const own = path.join(root, ...segments);
  return readEnvFile(
    existsSync(own) ? own : path.join(mainCheckout(), ...segments)
  );
}

const supabaseEnv = localEnv("infra", "supabase", ".env");
const appEnv = localEnv(".env");

function need(key: string): string {
  const value = supabaseEnv[key];
  if (!value) {
    throw new Error(
      `Falta ${key} en infra/supabase/.env (¿corriste infra:up?)`
    );
  }
  return value;
}

function loadState(): DemoState | null {
  return existsSync(stateFile)
    ? (JSON.parse(readFileSync(stateFile, "utf8")) as DemoState)
    : null;
}

function saveState(state: DemoState): void {
  mkdirSync(stateDirectory, { recursive: true });
  writeFileSync(stateFile, JSON.stringify(state), { mode: 0o600 });
}

function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of input.replace(/=+$/u, "")) {
    bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}

function totp(secret: string): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const hash = createHmac("sha1", base32Decode(secret))
    .update(counter)
    .digest();
  const offset = (hash[hash.length - 1] ?? 0) & 15;
  const code =
    (((hash[offset] ?? 0) & 127) << 24) |
    (((hash[offset + 1] ?? 0) & 255) << 16) |
    (((hash[offset + 2] ?? 0) & 255) << 8) |
    ((hash[offset + 3] ?? 0) & 255);
  return String(code % 1_000_000).padStart(6, "0");
}

async function auth(
  route: string,
  init: { body?: unknown; headers: Record<string, string> }
): Promise<{ body: Record<string, unknown>; status: number }> {
  const response = await fetch(`${supabaseUrl}${route}`, {
    body: JSON.stringify(init.body ?? {}),
    headers: { "content-type": "application/json", ...init.headers },
    method: "POST"
  });
  const text = await response.text();
  return {
    body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
    status: response.status
  };
}

function sql(statement: string): void {
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      "supabase-db",
      "psql",
      "-U",
      "supabase_admin",
      "-d",
      "postgres",
      "-q",
      "-v",
      "ON_ERROR_STOP=1"
    ],
    { input: statement, stdio: ["pipe", "ignore", "inherit"] }
  );
}

function wipe(state: DemoState | null): void {
  sql(`
    create temporary table gone as select id from public.tenants where slug = 'demo-alta';
    delete from private.location_publications where tenant_id in (select id from gone);
    delete from private.published_catalogs where tenant_id in (select id from gone);
    delete from private.audit_events where tenant_id in (select id from gone);
    delete from public.tenants where id in (select id from gone);
    delete from auth.users where email = '${email}'${
      state ? ` or id = '${state.userId}'` : ""
    };
  `);
}

async function seed(): Promise<DemoState> {
  const secretKey = need("SUPABASE_SECRET_KEY");
  const publishableKey = need("SUPABASE_PUBLISHABLE_KEY");
  const password = `Demo-${randomBytes(6).toString("hex")}`;

  const created = await auth("/auth/v1/admin/users", {
    body: { email, email_confirm: true, password },
    headers: { apikey: secretKey, authorization: `Bearer ${secretKey}` }
  });
  if (created.status >= 300) {
    throw new Error(`No se pudo crear el usuario (${created.status})`);
  }
  const userId = String(created.body.id);

  const signedIn = await auth("/auth/v1/token?grant_type=password", {
    body: { email, password },
    headers: { apikey: publishableKey }
  });
  const bearer = {
    apikey: publishableKey,
    authorization: `Bearer ${String(signedIn.body.access_token)}`
  };
  const factor = await auth("/auth/v1/factors", {
    body: { factor_type: "totp", friendly_name: "demo", issuer: "Demo" },
    headers: bearer
  });
  const secret = String((factor.body.totp as { secret: string }).secret);
  const challenge = await auth(
    `/auth/v1/factors/${String(factor.body.id)}/challenge`,
    { headers: bearer }
  );
  const verified = await auth(
    `/auth/v1/factors/${String(factor.body.id)}/verify`,
    {
      body: { challenge_id: challenge.body.id, code: totp(secret) },
      headers: bearer
    }
  );
  if (verified.status >= 300) throw new Error("No se pudo activar el TOTP.");

  const tenantId = randomUUID();
  sql(`
    insert into public.tenants (id, slug, name, status) values ('${tenantId}', 'demo-alta', 'Negocio de prueba', 'active');
    insert into public.tenant_memberships (tenant_id, user_id, role) values ('${tenantId}', '${userId}', 'admin');
    insert into public.tenant_domains (tenant_id, hostname, kind, status, is_primary)
      values ('${tenantId}', '${hostname}', 'platform_subdomain', 'active', true);
  `);
  const state = { password, pids: [], secret, tenantId, userId };
  saveState(state);
  return state;
}

function launch(command: string, args: string[], cwd: string, log: string) {
  const out = openSync(path.join(stateDirectory, log), "w");
  const child = spawn(command, args, {
    cwd,
    detached: true,
    env: {
      ...process.env,
      ...appEnv,
      ADMIN_INVITE_REDIRECT_URL: `http://${hostname}:${webPort}/auth/callback`,
      API_METRICS_PORT: "9464",
      API_PORT: String(apiPort),
      APP_ENV: "development",
      DATABASE_URL: databaseUrl(),
      LOG_LEVEL: "info",
      NEXT_PUBLIC_API_URL: `http://localhost:${apiPort}`,
      NEXT_PUBLIC_APP_URL: `http://${hostname}:${webPort}`,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: need("SUPABASE_PUBLISHABLE_KEY"),
      NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
      PLATFORM_BASE_DOMAIN: "dev.localhost",
      STAFF_PIN_PEPPER: "demo-pepper-with-at-least-32-characters",
      SUPABASE_SECRET_KEY: need("SUPABASE_SECRET_KEY"),
      SUPABASE_URL: supabaseUrl,
      WEB_METRICS_PORT: "9466"
    },
    shell: process.platform === "win32" && command !== process.execPath,
    stdio: ["ignore", out, out]
  });
  child.unref();
  closeSync(out);
  return child.pid ?? 0;
}

function databaseUrl(): string {
  const password = encodeURIComponent(need("POSTGRES_PASSWORD"));
  return `postgresql://authenticator.${need("POOLER_TENANT_ID")}:${password}@127.0.0.1:54322/postgres`;
}

function stop(pids: number[]): void {
  for (const pid of pids) {
    try {
      if (process.platform === "win32") {
        execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
          stdio: "ignore"
        });
      } else {
        process.kill(-pid, "SIGTERM");
      }
    } catch {
      // ya estaba detenido
    }
  }
}

async function waitFor(url: string, label: string): Promise<void> {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      if ((await fetch(url)).status < 500) return;
    } catch {
      // todavía no escucha
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`${label} no respondió a tiempo (ver .supabase/demo-*.log)`);
}

async function up(): Promise<void> {
  let state = loadState();
  if (state) stop(state.pids);
  if (!state) {
    wipe(null);
    state = await seed();
  }
  mkdirSync(stateDirectory, { recursive: true });
  const api = launch(
    process.execPath,
    ["./node_modules/tsx/dist/cli.mjs", "src/main.ts"],
    path.join(root, "apps", "api"),
    "demo-api.log"
  );
  const web = launch(
    "corepack",
    ["pnpm", "exec", "next", "dev", "--webpack", "-p", String(webPort)],
    path.join(root, "apps", "web"),
    "demo-web.log"
  );
  // Sin el worker las imágenes y las importaciones quedarían en "procesando".
  const worker = launch(
    process.execPath,
    ["./node_modules/tsx/dist/cli.mjs", "src/main.ts"],
    path.join(root, "apps", "worker"),
    "demo-worker.log"
  );
  saveState({ ...state, pids: [api, web, worker] });
  await waitFor(`http://localhost:${apiPort}/health`, "La API");
  await waitFor(`http://${hostname}:${webPort}/acceso`, "La web");

  console.info(`
Listo. Entrá a:  http://${hostname}:${webPort}/acceso
  Correo:      ${email}
  Contraseña:  ${state.password}
  Código TOTP: pnpm demo:totp   (o cargá este secreto en tu app: ${state.secret})

Después andá a http://${hostname}:${webPort}/panel/publicar
Para empezar de cero: pnpm demo:reset && pnpm demo:up   ·   Para detener: pnpm demo:down`);
}

const command = process.argv[2];
if (command === "up") {
  await up();
} else if (command === "totp") {
  const state = loadState();
  if (!state) throw new Error("No hay entorno de prueba: corré pnpm demo:up");
  console.info(totp(state.secret));
} else if (command === "down") {
  const state = loadState();
  if (state) {
    stop(state.pids);
    saveState({ ...state, pids: [] });
  }
  console.info("API, web y worker detenidos.");
} else if (command === "reset") {
  const state = loadState();
  if (state) stop(state.pids);
  wipe(state);
  rmSync(stateFile, { force: true });
  console.info("Negocio y usuario de prueba eliminados.");
} else {
  console.info("Uso: demo-onboarding up | totp | down | reset");
}
