import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { tenantFetch } from "./tenant-fetch";

let server: Server;
let apiUrl: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          authorization: req.headers.authorization,
          body: Buffer.concat(chunks).toString(),
          host: req.headers.host,
          method: req.method
        })
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  apiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe("tenantFetch (HTTP real)", () => {
  it("fetch nativo pierde la cabecera Host del tenant (reproducción)", async () => {
    const response = await fetch(`${apiUrl}/v1/tenant/floor-plan`, {
      headers: { host: "cafe-norte.plataforma.test" }
    });
    const seen = (await response.json()) as { host: string };
    expect(seen.host).not.toBe("cafe-norte.plataforma.test");
  });

  it("entrega Host del tenant, Bearer y cuerpo a la API", async () => {
    const response = await tenantFetch(`${apiUrl}/v1/tenant/floor-plan`, {
      body: JSON.stringify({ name: "Salón" }),
      headers: {
        authorization: "Bearer token",
        "content-type": "application/json",
        host: "cafe-norte.plataforma.test"
      },
      method: "PUT"
    });
    expect(response.ok).toBe(true);
    expect(await response.json()).toEqual({
      authorization: "Bearer token",
      body: '{"name":"Salón"}',
      host: "cafe-norte.plataforma.test",
      method: "PUT"
    });
  });

  describe("con API_URL interno (producción detrás del proxy público)", () => {
    const original = { ...process.env };
    afterEach(() => {
      process.env = { ...original };
    });

    it("manda a la red interna lo que apunta a la URL pública de la API, conservando el Host del negocio", async () => {
      // La URL pública reenviaría la solicitud según `Host` y nunca llegaría a la API.
      process.env.NEXT_PUBLIC_API_URL = "http://api-publica.invalid:3001";
      process.env.API_URL = apiUrl;

      const response = await tenantFetch(
        "http://api-publica.invalid:3001/v1/tenant/payment-methods?x=1",
        { headers: { host: "app-carta.wizzi.com.ar" } }
      );

      expect(await response.json()).toMatchObject({
        host: "app-carta.wizzi.com.ar",
        method: "GET"
      });
    });

    it("no toca destinos que no son la URL pública de la API", async () => {
      process.env.NEXT_PUBLIC_API_URL = "http://api-publica.invalid:3001";
      process.env.API_URL = "http://127.0.0.1:9";

      const response = await tenantFetch(`${apiUrl}/v1/x`, {
        headers: { host: "cafe-norte.plataforma.test" }
      });

      expect(response.ok).toBe(true);
    });
  });
});
