import type { ExecutionContext } from "@nestjs/common";
import { SELF_DECLARED_DEPS_METADATA } from "@nestjs/common/constants.js";
import type { TenantHostContext } from "@platform/contracts";
import { describe, expect, it } from "vitest";

import { TenantHostGuard } from "./tenant-host.guard.js";
import { TenantHostService } from "./tenant-host.service.js";

describe("TenantHostGuard", () => {
  it("declares its resolver dependency explicitly", () => {
    expect(
      Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, TenantHostGuard)
    ).toEqual([{ index: 0, param: TenantHostService }]);
  });

  it("attaches context derived only from Host", async () => {
    const tenantHostContext: TenantHostContext = {
      domain: { hostname: "real.plataforma.test", id: "domain-a" },
      location: { id: "location-a", name: "Principal" },
      tenant: { id: "tenant-a", name: "Tenant A", slug: "tenant-a" }
    };
    const authorities: unknown[] = [];
    const guard = new TenantHostGuard({
      resolve: async (authority: unknown) => {
        authorities.push(authority);
        return tenantHostContext;
      },
      resolveForAdmin: async () => {
        throw new Error("public requests must use the public resolver");
      }
    } as unknown as TenantHostService);
    const request: {
      headers: Record<string, string>;
      tenantHostContext?: TenantHostContext;
    } = {
      headers: {
        host: "real.plataforma.test:3001",
        "x-forwarded-host": "attacker.plataforma.test"
      }
    };
    const executionContext = {
      switchToHttp: () => ({ getRequest: () => request })
    } as ExecutionContext;

    await expect(guard.canActivate(executionContext)).resolves.toBe(true);
    expect(authorities).toEqual(["real.plataforma.test:3001"]);
    expect(request.tenantHostContext).toEqual(tenantHostContext);
  });

  it("uses the membership-aware resolver after administrator authentication", async () => {
    const tenantHostContext: TenantHostContext = {
      domain: { hostname: "draft.plataforma.test", id: "domain-a" },
      location: { id: "location-a", name: "Principal" },
      tenant: { id: "tenant-a", name: "Tenant A", slug: "tenant-a" }
    };
    const received: unknown[] = [];
    const guard = new TenantHostGuard({
      resolve: async () => {
        throw new Error(
          "administrative requests must not use the public resolver"
        );
      },
      resolveForAdmin: async (authority: unknown, requesterId: string) => {
        received.push(authority, requesterId);
        return tenantHostContext;
      }
    } as unknown as TenantHostService);
    const request = {
      adminIdentity: {
        assuranceLevel: "aal2",
        userId: "10000000-0000-4000-8000-000000000001"
      },
      headers: { host: "draft.plataforma.test:3001" },
      tenantHostContext: undefined
    };
    const executionContext = {
      switchToHttp: () => ({ getRequest: () => request })
    } as ExecutionContext;

    await expect(guard.canActivate(executionContext)).resolves.toBe(true);
    expect(received).toEqual([
      "draft.plataforma.test:3001",
      "10000000-0000-4000-8000-000000000001"
    ]);
    expect(request.tenantHostContext).toEqual(tenantHostContext);
  });
});
