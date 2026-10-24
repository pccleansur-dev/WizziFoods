import { spawn } from "node:child_process";
import path from "node:path";
import postgres from "postgres";

import { hashStaffPin } from "../apps/api/src/staff-auth/pin-credential.ts";
import {
  adminDatabaseUrl,
  apiPort,
  ownerDatabaseUrl,
  stackEnv,
  webPort
} from "./stack-env.ts";

// Demo persistente (no se borra al terminar): negocio "Wizzi Foods".
const slug = "wizzifoods";
const hostname = "wizzifoods.localhost";
const pin = "246810";
const pepper = "e2e-pepper-with-at-least-32-characters";
const tenantId = "ec000000-0000-4000-8000-000000000013";
const userId = "ec000000-0000-4000-8000-000000000011";

const id = (group: number, n: number) =>
  `ec${group}00000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const level = id(1, 0xf1);
const salon = id(1, 1);
const terraza = id(1, 2);

function table(n: number, sector: string, x: number, y: number) {
  return {
    floorId: level,
    height: 100,
    id: id(2, n),
    label: String(n),
    rotation: 0,
    seatCount: 4,
    seatLayout: "perimeter",
    sectorId: sector,
    shape: "square",
    width: 100,
    x,
    y
  };
}

const plan = {
  floors: [{ id: level, name: "Salón", position: 0, shortName: null }],
  groups: [],
  sectors: [
    { id: salon, name: "Salón", position: 0 },
    { id: terraza, name: "Terraza", position: 1 }
  ],
  tables: [
    table(1, salon, 40, 40),
    table(2, salon, 200, 40),
    table(3, salon, 360, 40),
    table(4, salon, 40, 200),
    table(5, terraza, 200, 200),
    table(6, terraza, 360, 200)
  ]
};

const kitchen = id(5, 1);
const bar = id(5, 2);
const categories = [
  ["Entradas", id(6, 1)],
  ["Platos principales", id(6, 2)],
  ["Pizzas", id(6, 3)],
  ["Postres", id(6, 4)],
  ["Bebidas", id(6, 5)],
  ["Cafetería", id(6, 6)]
] as const;

type Item = [
  category: number,
  sector: string,
  title: string,
  description: string,
  pesos: number,
  variants?: [string, number][]
];
const items: Item[] = [
  [0, kitchen, "Provoleta", "Provolone a la parrilla con orégano y tomate.", 9500],
  [0, kitchen, "Empanadas de carne", "Cortadas a cuchillo, horno de barro. Por 3 unidades.", 8700],
  [0, kitchen, "Rabas", "Anillas de calamar con alioli de limón.", 13800],
  [0, kitchen, "Tabla de fiambres", "Jamón crudo, salame, queso y aceitunas.", 16500],
  [1, kitchen, "Milanesa con papas", "De lomo, con papas rústicas.", 14500, [["Napolitana", 2500]]],
  [1, kitchen, "Bife de chorizo", "350 g a la parrilla con guarnición a elección.", 21500],
  [1, kitchen, "Ravioles de ricota", "Con salsa fileto o crema de hongos.", 13200, [["Crema de hongos", 1800]]],
  [1, kitchen, "Salmón grillado", "Con puré de calabaza y vegetales salteados.", 22800],
  [1, kitchen, "Ensalada Wisi", "Rúcula, parmesano, tomates cherry y nueces.", 11200],
  [2, kitchen, "Pizza Muzzarella", "Salsa de tomate, muzzarella y aceitunas.", 12800, [["Grande", 3500]]],
  [2, kitchen, "Pizza Fugazzeta", "Cebolla, muzzarella y orégano.", 14200, [["Grande", 3500]]],
  [3, kitchen, "Flan casero", "Con dulce de leche y crema.", 6800],
  [3, kitchen, "Brownie con helado", "Chocolate tibio y helado de crema.", 8200],
  [4, bar, "Cerveza artesanal", "IPA o Honey, pinta de 500 ml.", 6200, [["Honey", 0]]],
  [4, bar, "Limonada con menta", "Exprimida en el momento. Jarra de 1 litro.", 5800],
  [4, bar, "Copa de vino", "Malbec de la casa.", 6900],
  [4, bar, "Gaseosa", "Línea Coca-Cola, 500 ml.", 3800],
  [4, bar, "Agua mineral", "Con o sin gas, 500 ml.", 2900],
  [5, bar, "Café espresso", "Doble, de tostado artesanal.", 3200],
  [5, bar, "Cappuccino", "Con espuma de leche y cacao.", 4100],
  [5, bar, "Submarino", "Leche caliente con barra de chocolate.", 4600]
];

const products = items.map(
  ([category, sector, title, description, pesos, variants], index) => ({
    categoryId: categories[category]![1],
    content: [{ description, language: "es", title }],
    id: id(7, index + 1),
    imageAssetId: null,
    position: index,
    priceCents: pesos * 100,
    sectorId: sector,
    variants: (variants ?? []).map(([name, delta], position) => ({
      content: [{ description: "", language: "es", title: name }],
      id: id(8, (index + 1) * 10 + position),
      position,
      priceDeltaCents: delta * 100
    }))
  })
);

const catalog = {
  baseRevision: null,
  categories: categories.map(([title, categoryId], position) => ({
    content: [{ description: "", language: "es", title }],
    id: categoryId,
    position
  })),
  products,
  sectors: [
    { id: kitchen, kind: "kitchen", name: "Cocina", position: 0 },
    { id: bar, kind: "bar", name: "Barra", position: 1 }
  ]
};

const sql = postgres(adminDatabaseUrl(), { prepare: false });
const owner = postgres(ownerDatabaseUrl(), { prepare: false });

// Limpieza previa (sólo de este negocio) para poder volver a sembrar.
await owner.begin(async (tx) => {
  await tx`set local session_replication_role = replica`;
  for (const table of [
    "production_item_events",
    "production_items",
    "confirmed_order_items",
    "confirmed_orders",
    "order_intent_decisions",
    "order_intent_items",
    "order_intents"
  ]) {
    await tx`delete from ${tx(`private.${table}`)} where tenant_id = ${tenantId}`;
  }
});
for (const table of [
  "waiter_commands",
  "waiter_calls",
  "order_intent_commands",
  "audit_events",
  "published_catalogs",
  "location_publications"
]) {
  await owner`delete from ${owner(`private.${table}`)} where tenant_id = ${tenantId}`;
}
await sql`delete from public.tenants where id = ${tenantId}`;
await sql`delete from auth.users where id = ${userId}`;

await sql`insert into auth.users (id) values (${userId})`;
await sql`
  insert into public.tenants (id, slug, name, status)
  values (${tenantId}, ${slug}, 'Wizzi Foods', 'active')
`;
await sql`
  insert into public.tenant_memberships (tenant_id, user_id, role)
  values (${tenantId}, ${userId}, 'admin')
`;
await sql`
  insert into public.tenant_domains (tenant_id, hostname, kind, status, is_primary)
  values (${tenantId}, ${hostname}, 'platform_subdomain', 'active', true)
`;
// Para abrir la demo desde otro dispositivo de la red: DEMO_EXTRA_HOST=<nombre DNS>
// (la API no acepta IP; sirve p. ej. wizzifoods.192-168-0-18.nip.io).
if (process.env.DEMO_EXTRA_HOST) {
  await sql`
    insert into public.tenant_domains (tenant_id, hostname, kind, status, is_primary)
    values (${tenantId}, ${process.env.DEMO_EXTRA_HOST}, 'platform_subdomain', 'active', false)
  `;
}
const [location] = await sql<{ id: string }[]>`
  select id from public.locations where tenant_id = ${tenantId}
`;
const locationId = location!.id;
await sql`
  select private.save_floor_plan(
    ${tenantId}::uuid, ${locationId}::uuid, ${userId}::uuid,
    ${id(4, 1)}::uuid, 0, ${sql.json(plan)}
  )
`;
const qrs = await sql<{ label: string; token: string }[]>`
  select label, token from private.list_floor_table_qr_codes(
    ${tenantId}::uuid, ${locationId}::uuid, ${userId}::uuid
  ) order by label
`;
await sql`
  insert into private.location_publications (tenant_id, location_id, published_by)
  values (${tenantId}, ${locationId}, ${userId})
`;
await sql`select private.ensure_payment_methods(${tenantId}::uuid, ${locationId}::uuid)`;
await owner`
  insert into private.published_catalogs (
    tenant_id, location_id, revision, source_draft_revision, snapshot, published_by
  ) values (${tenantId}, ${locationId}, 1, 1, ${sql.json(catalog)}, ${userId})
`;
const hash = await hashStaffPin(pin, pepper);
for (const [name, role, sectors] of [
  ["ana", "waiter", [salon]],
  ["bruno", "waiter", [terraza]],
  ["marta", "manager", []],
  ["coco", "kitchen", []],
  ["beto", "bar", []]
] as const) {
  await sql`
    select private.create_staff_member(
      ${tenantId}::uuid, ${locationId}::uuid, ${userId}::uuid,
      ${name}, ${name}, ${role}, ${hash}, ${[...sectors]}::uuid[]
    )
  `;
}
await sql.end();
await owner.end();

console.log(
  "DEMO_READY",
  JSON.stringify({
    apiPort,
    mesas: Object.fromEntries(qrs.map((row) => [row.label, row.token])),
    productos: products.length,
    webPort
  })
);

const env = { ...process.env, ...stackEnv() };
const root = path.resolve(import.meta.dirname, "..");
spawn("node", ["./node_modules/tsx/dist/cli.mjs", "src/main.ts"], {
  cwd: path.join(root, "apps/api"),
  env,
  stdio: "inherit"
});
spawn("corepack", ["pnpm", "exec", "next", "dev", "--webpack", "-p", String(webPort)], {
  cwd: path.join(root, "apps/web"),
  env,
  shell: true,
  stdio: "inherit"
});
setInterval(() => undefined, 1 << 30);
