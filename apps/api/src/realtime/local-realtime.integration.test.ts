import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication
} from "@nestjs/platform-fastify";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ApiRuntimeConfig } from "@platform/config";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../app.module.js";
import { hashStaffPin } from "../staff-auth/pin-credential.js";
import { RealtimeTokenService } from "./realtime-token.service.js";

const databaseUrl = process.env.DATABASE_URL;
const databaseAdminUrl = process.env.DATABASE_ADMIN_URL;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
const jwtSecret = process.env.SUPABASE_JWT_SECRET;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const hasStack =
  databaseUrl &&
  databaseAdminUrl &&
  supabaseUrl &&
  supabaseSecretKey &&
  jwtSecret &&
  publishableKey;
const describeWithStack = hasStack ? describe : describe.skip;

const pepper = "test-pepper-with-at-least-32-characters";
const pin = "135790";
const clients = Number(process.env.REALTIME_LOAD_CLIENTS ?? 60);
const bursts = 20;

type Fixture = { slug: string; tenantId: string; userId: string };
const one: Fixture = {
  slug: "rt-it-1",
  tenantId: "3f000000-0000-4000-8000-000000000013",
  userId: "3f000000-0000-4000-8000-000000000011"
};
const two: Fixture = {
  slug: "rt-it-2",
  tenantId: "3f000000-0000-4000-8000-000000000023",
  userId: "3f000000-0000-4000-8000-000000000021"
};

type Listener = {
  channel: string;
  client: SupabaseClient;
  got: number[];
  status: string;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check: () => boolean, ms = 15_000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) return false;
    await sleep(50);
  }
  return true;
}

describeWithStack("private Realtime channels against local Supabase", () => {
  const admin = postgres(databaseAdminUrl ?? "", { prepare: false });
  let app: NestFastifyApplication | undefined;
  const locations = new Map<string, string>();
  const sessions = new Map<string, string>();
  const open: SupabaseClient[] = [];

  async function cleanup() {
    for (const fixture of [one, two]) {
      await admin.begin(async (tx) => {
        await tx`set local session_replication_role = replica`;
        await tx`delete from private.floor_table_service_states where tenant_id = ${fixture.tenantId}`;
        await tx`delete from private.floor_tables where tenant_id = ${fixture.tenantId}`;
        await tx`delete from private.floor_plans where tenant_id = ${fixture.tenantId}`;
      });
      await admin`delete from private.audit_events where tenant_id = ${fixture.tenantId}`;
      await admin`delete from public.tenants where id = ${fixture.tenantId}`;
      await admin`delete from auth.users where id = ${fixture.userId}`;
    }
  }

  async function staff(fixture: Fixture, username: string, role: string) {
    const hash = await hashStaffPin(pin, pepper);
    await admin`
      select private.create_staff_member(
        ${fixture.tenantId}::uuid, ${locations.get(fixture.slug)!}::uuid, ${fixture.userId}::uuid,
        ${username}, ${username}, ${role}, ${hash}, '{}'::uuid[])`;
    const login = await app!
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "POST",
        payload: { pin, username },
        url: `/v1/tenants/${fixture.slug}/staff-sessions`
      });
    expect(login.statusCode).toBe(201);
    sessions.set(`${fixture.slug}:${username}`, login.json().data.accessToken);
  }

  async function grantOf(fixture: Fixture, username: string) {
    const response = await app!
      .getHttpAdapter()
      .getInstance()
      .inject({
        headers: {
          authorization: `Bearer ${sessions.get(`${fixture.slug}:${username}`)}`
        },
        method: "POST",
        url: "/v1/staff/realtime/token"
      });
    return {
      body: response.json() as {
        data?: { channels: string[]; token: string };
      },
      status: response.statusCode
    };
  }

  function listen(token: string, channel: string): Listener {
    const client = createClient(supabaseUrl ?? "", publishableKey ?? "", {
      auth: { persistSession: false }
    });
    open.push(client);
    client.realtime.setAuth(token);
    const listener: Listener = { channel, client, got: [], status: "" };
    client
      .channel(channel, { config: { private: true } })
      .on("broadcast", { event: "changed" }, () =>
        listener.got.push(Date.now())
      )
      .subscribe((status) => {
        listener.status = status;
      });
    return listener;
  }

  const touch = (fixture: Fixture) =>
    admin`update private.floor_tables set label = label where tenant_id = ${fixture.tenantId}`;

  beforeAll(async () => {
    await cleanup();
    for (const fixture of [one, two]) {
      await admin`insert into auth.users (id) values (${fixture.userId})`;
      await admin`
        insert into public.tenants (id, slug, name, status)
        values (${fixture.tenantId}, ${fixture.slug}, 'Realtime IT', 'active')`;
      await admin`
        insert into public.tenant_memberships (tenant_id, user_id, role)
        values (${fixture.tenantId}, ${fixture.userId}, 'admin')`;
      await admin`
        insert into public.tenant_domains (tenant_id, hostname, kind, status, is_primary)
        values (${fixture.tenantId}, ${`${fixture.slug}.plataforma.test`}, 'platform_subdomain', 'active', true)`;
      const [location] = await admin<{ id: string }[]>`
        select id from public.locations where tenant_id = ${fixture.tenantId}`;
      locations.set(fixture.slug, location!.id);
      await admin`
        select private.save_floor_plan(
          ${fixture.tenantId}::uuid, ${location!.id}::uuid, ${fixture.userId}::uuid,
          gen_random_uuid(), 0,
          ${admin.json({
            floors: [
              {
                id: "3f400000-0000-4000-8000-000000000001",
                name: "Planta",
                position: 0,
                shortName: null
              }
            ],
            groups: [],
            sectors: [
              {
                id: "3f500000-0000-4000-8000-000000000001",
                name: "Salón",
                position: 0
              }
            ],
            tables: [
              {
                floorId: "3f400000-0000-4000-8000-000000000001",
                height: 100,
                id: "3f600000-0000-4000-8000-000000000001",
                label: "1",
                rotation: 0,
                sectorId: "3f500000-0000-4000-8000-000000000001",
                seatCount: 4,
                seatLayout: "perimeter",
                shape: "square",
                width: 100,
                x: 40,
                y: 40
              }
            ]
          })})`;
    }
    const config: ApiRuntimeConfig = {
      adminInviteRedirectUrl: "https://app.example.test/auth/callback",
      databaseUrl: databaseUrl ?? "",
      environment: "test",
      logLevel: "error",
      metricsPort: 9464,
      paymentSecretKey: null,
      platformBaseDomain: "plataforma.test",
      platformTenantHostTemplate: "{slug}.{domain}",
      port: 3001,
      realtimeJwtSecret: jwtSecret ?? null,
      staffPinPepper: pepper,
      supabaseSecretKey: supabaseSecretKey ?? "",
      supabaseUrl: supabaseUrl ?? ""
    };
    app = await NestFactory.create<NestFastifyApplication>(
      AppModule.register(config),
      new FastifyAdapter(),
      { logger: false }
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    await staff(one, "marta", "manager");
    await staff(one, "ana", "waiter");
    await staff(one, "coco", "kitchen");
    await staff(one, "barra", "bar");
    await staff(two, "otra", "manager");
    await staff(two, "luis", "waiter");
  }, 120_000);

  afterAll(async () => {
    for (const client of open) await client.removeAllChannels();
    await app?.close();
    await cleanup();
    await admin.end();
  });

  it("gives a token only to a signed-in staff member, with the channels of their role", async () => {
    const anonymous = await app!
      .getHttpAdapter()
      .getInstance()
      .inject({ method: "POST", url: "/v1/staff/realtime/token" });
    expect(anonymous.statusCode).toBe(401);
    const prefix = `tenant:${one.tenantId}:location:${locations.get(one.slug)}:`;
    expect((await grantOf(one, "ana")).body.data!.channels).toEqual([
      `${prefix}salon`
    ]);
    expect((await grantOf(one, "marta")).body.data!.channels).toEqual([
      `${prefix}salon`,
      `${prefix}cash`
    ]);
    expect((await grantOf(one, "coco")).body.data!.channels).toEqual([
      `${prefix}production-kitchen`
    ]);
  });

  it("delivers a change to who may hear it and to nobody else", async () => {
    const prefix = (f: Fixture) =>
      `tenant:${f.tenantId}:location:${locations.get(f.slug)}:`;
    const waiter = listen(
      (await grantOf(one, "ana")).body.data!.token,
      `${prefix(one)}salon`
    );
    const manager = listen(
      (await grantOf(one, "marta")).body.data!.token,
      `${prefix(one)}cash`
    );
    const kitchen = listen(
      (await grantOf(one, "coco")).body.data!.token,
      `${prefix(one)}production-kitchen`
    );
    const bar = listen(
      (await grantOf(one, "barra")).body.data!.token,
      `${prefix(one)}production-bar`
    );
    const neighbour = listen(
      (await grantOf(two, "luis")).body.data!.token,
      `${prefix(two)}salon`
    );
    // Not theirs: a waiter asking for the kitchen, a neighbour asking for this salon.
    const nosy = listen(
      (await grantOf(one, "ana")).body.data!.token,
      `${prefix(one)}production-kitchen`
    );
    const spy = listen(
      (await grantOf(two, "otra")).body.data!.token,
      `${prefix(one)}salon`
    );
    expect(
      await until(() =>
        [waiter, manager, kitchen, bar, neighbour].every(
          (l) => l.status === "SUBSCRIBED"
        )
      )
    ).toBe(true);
    await sleep(1_000);
    expect(nosy.status).not.toBe("SUBSCRIBED");
    expect(spy.status).not.toBe("SUBSCRIBED");

    await touch(one);
    expect(await until(() => waiter.got.length === 1)).toBe(true);
    await admin`select private.notify_realtime(${one.tenantId}::uuid, ${locations.get(one.slug)!}::uuid, 'production-kitchen')`;
    expect(await until(() => kitchen.got.length === 1)).toBe(true);
    await sleep(1_500);
    expect(waiter.got).toHaveLength(1);
    expect(manager.got).toHaveLength(0);
    expect(kitchen.got).toHaveLength(1);
    expect(bar.got).toHaveLength(0);
    expect(neighbour.got).toHaveLength(0);
    expect(nosy.got).toHaveLength(0);
    expect(spy.got).toHaveLength(0);
  });

  it("lets a diner hear only the table their QR stands for", async () => {
    const qrOf = async (fixture: Fixture) => {
      const [row] = await admin<{ token: string }[]>`
        select token from private.list_floor_table_qr_codes(
          ${fixture.tenantId}::uuid, ${locations.get(fixture.slug)!}::uuid,
          ${fixture.userId}::uuid)`;
      return row!.token;
    };
    const dinerGrant = async (fixture: Fixture, token: string) => {
      const response = await app!
        .getHttpAdapter()
        .getInstance()
        .inject({
          headers: { host: `${fixture.slug}.plataforma.test` },
          method: "POST",
          payload: { token },
          url: "/v1/public/realtime/token"
        });
      return {
        body: response.json() as {
          data?: { channels: string[]; token: string };
        },
        status: response.statusCode
      };
    };
    const mine = await dinerGrant(one, await qrOf(one));
    expect(mine.status).toBe(200);
    const channel = `tenant:${one.tenantId}:location:${locations.get(one.slug)}:table-3f600000-0000-4000-8000-000000000001`;
    expect(mine.body.data!.channels).toEqual([channel]);
    // A QR of the neighbour restaurant means nothing on this host.
    expect((await dinerGrant(one, await qrOf(two))).status).toBe(404);

    const diner = listen(mine.body.data!.token, channel);
    const salon = listen(
      mine.body.data!.token,
      `tenant:${one.tenantId}:location:${locations.get(one.slug)}:salon`
    );
    expect(await until(() => diner.status === "SUBSCRIBED")).toBe(true);
    await sleep(1_000);
    // The same token cannot listen to the staff channel.
    expect(salon.status).not.toBe("SUBSCRIBED");

    await admin`
      insert into private.floor_table_service_states (tenant_id, location_id, table_id, state)
      values (${one.tenantId}, ${locations.get(one.slug)!}, '3f600000-0000-4000-8000-000000000001', 'occupied')
      on conflict (tenant_id, location_id, table_id) do update set state = 'needs_cleaning'`;
    expect(await until(() => diner.got.length >= 1)).toBe(true);
    expect(salon.got).toHaveLength(0);
  });

  it("refuses an expired token", async () => {
    const past = new RealtimeTokenService(
      jwtSecret!,
      () => new Date(Date.now() - 3_600_000)
    );
    const grant = await past.issue({
      capabilities: ["tables.serve"],
      scope: { locationId: locations.get(one.slug)!, tenantId: one.tenantId },
      staffId: "3f000000-0000-4000-8000-0000000000aa"
    });
    const stale = listen(grant.token, grant.channels[0]!);
    await sleep(3_000);
    expect(stale.status).not.toBe("SUBSCRIBED");
  });

  it("does not replay what was missed: a reconnected screen must ask for the state", async () => {
    const channel = `tenant:${one.tenantId}:location:${locations.get(one.slug)}:salon`;
    const waiter = listen(
      (await grantOf(one, "ana")).body.data!.token,
      channel
    );
    expect(await until(() => waiter.status === "SUBSCRIBED")).toBe(true);
    await waiter.client.removeAllChannels();
    await touch(one);
    await sleep(1_500);
    const again = listen((await grantOf(one, "ana")).body.data!.token, channel);
    expect(await until(() => again.status === "SUBSCRIBED")).toBe(true);
    await sleep(1_500);
    expect(waiter.got).toHaveLength(0);
    expect(again.got).toHaveLength(0);
    await touch(one);
    expect(await until(() => again.got.length === 1)).toBe(true);
  });

  it(`serves ${clients * 2} listeners on two restaurants without crossing them`, async () => {
    const prefix = (f: Fixture) =>
      `tenant:${f.tenantId}:location:${locations.get(f.slug)}:salon`;
    const tokens = {
      [one.slug]: (await grantOf(one, "ana")).body.data!.token,
      [two.slug]: (await grantOf(two, "luis")).body.data!.token
    };
    const listeners: Listener[] = [];
    for (let batch = 0; batch < clients; batch += 20) {
      for (let n = batch; n < Math.min(batch + 20, clients); n += 1) {
        listeners.push(listen(tokens[one.slug]!, prefix(one)));
        listeners.push(listen(tokens[two.slug]!, prefix(two)));
      }
      await sleep(400);
    }
    expect(
      await until(
        () => listeners.every((l) => l.status === "SUBSCRIBED"),
        60_000
      )
    ).toBe(true);

    const started = Date.now();
    for (let n = 0; n < bursts; n += 1) {
      await touch(n % 2 === 0 ? one : two);
      await sleep(150);
    }
    const expected = bursts / 2;
    const everyoneHeard = await until(
      () => listeners.every((l) => l.got.length >= expected),
      30_000
    );
    await sleep(1_500);
    expect(everyoneHeard).toBe(true);
    // Each listener heard exactly the changes of its own restaurant.
    expect(listeners.every((l) => l.got.length === expected)).toBe(true);
    const latest = Math.max(...listeners.flatMap((l) => l.got)) - started;
    expect(latest).toBeLessThan(bursts * 150 + 5_000);
  }, 180_000);
});
