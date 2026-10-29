import { NotFoundException } from "@nestjs/common";
import type { TenantHostContext } from "@platform/contracts";
import { describe, expect, it } from "vitest";

import { TenantHostService } from "./tenant-host.service.js";

const context: TenantHostContext = {
  domain: { hostname: "local-a.plataforma.test", id: "domain-a" },
  location: { id: "location-a", name: "Principal" },
  tenant: { id: "tenant-a", name: "Tenant A", slug: "tenant-a" }
};

describe("TenantHostService", () => {
  it("canonicalizes the request authority before resolving it", async () => {
    const resolved: string[] = [];
    const service = new TenantHostService(
      {
        resolveAdminByHostname: async () => null,
        resolveSoleAdminTenant: async () => null,
        resolveByHostname: async (hostname: string) => {
          resolved.push(hostname);
          return context;
        }
      },
      "app.plataforma.test"
    );

    await expect(
      service.resolve("LOCAL-A.PLATAFORMA.TEST:3001")
    ).resolves.toEqual(context);
    expect(resolved).toEqual(["local-a.plataforma.test"]);
  });

  it("fails closed before querying for malformed authorities", async () => {
    const service = new TenantHostService(
      {
        resolveAdminByHostname: async () => null,
        resolveSoleAdminTenant: async () => null,
        resolveByHostname: async () => {
          throw new Error("repository must not be queried");
        }
      },
      "app.plataforma.test"
    );

    await expect(
      service.resolve("local-a.plataforma.test,attacker.test")
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("uses the same generic not-found response for an unknown host", async () => {
    const service = new TenantHostService(
      {
        resolveAdminByHostname: async () => null,
        resolveSoleAdminTenant: async () => null,
        resolveByHostname: async () => null
      },
      "app.plataforma.test"
    );

    await expect(
      service.resolve("unknown.plataforma.test")
    ).rejects.toMatchObject({
      response: {
        error: {
          code: "TENANT_NOT_FOUND"
        }
      }
    });
  });

  it("resolves draft tenants only through an assigned administrator", async () => {
    const received: unknown[] = [];
    const service = new TenantHostService(
      {
        resolveAdminByHostname: async (hostname, requesterId) => {
          received.push(hostname, requesterId);
          return context;
        },
        resolveSoleAdminTenant: async () => null,
        resolveByHostname: async () => null
      },
      "app.plataforma.test"
    );

    await expect(
      service.resolveForAdmin(
        "LOCAL-A.PLATAFORMA.TEST:3001",
        "10000000-0000-4000-8000-000000000001"
      )
    ).resolves.toEqual(context);
    expect(received).toEqual([
      "local-a.plataforma.test",
      "10000000-0000-4000-8000-000000000001"
    ]);
  });

  it("resolves the sole assigned tenant when administration runs on the platform host", async () => {
    const requesterId = "10000000-0000-4000-8000-000000000001";
    const received: string[] = [];
    const service = new TenantHostService(
      {
        resolveAdminByHostname: async (hostname) => {
          received.push(`host:${hostname}`);
          return null;
        },
        resolveSoleAdminTenant: async (requester) => {
          received.push(`identity:${requester}`);
          return context;
        },
        resolveByHostname: async () => null
      },
      "app.plataforma.test"
    );

    await expect(
      service.resolveForAdmin("APP.PLATAFORMA.TEST:443", requesterId)
    ).resolves.toEqual(context);
    expect(received).toEqual([
      "host:app.plataforma.test",
      `identity:${requesterId}`
    ]);
  });

  it("never applies the sole-tenant fallback to an unrelated hostname", async () => {
    let fallbackCalled = false;
    const service = new TenantHostService(
      {
        resolveAdminByHostname: async () => null,
        resolveSoleAdminTenant: async () => {
          fallbackCalled = true;
          return context;
        },
        resolveByHostname: async () => null
      },
      "app.plataforma.test"
    );

    await expect(
      service.resolveForAdmin(
        "unrelated.example",
        "10000000-0000-4000-8000-000000000001"
      )
    ).rejects.toMatchObject({ status: 404 });
    expect(fallbackCalled).toBe(false);
  });
});
